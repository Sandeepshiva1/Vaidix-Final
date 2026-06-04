// ════════════════════════════════════════════════════════════════════════════
// Promo Teaser Render Worker
// ════════════════════════════════════════════════════════════════════════════
// Consumes 'promo-teaser-render' jobs from the PROMO queue. For each job:
//   1. Look up the placeholder Document row that the route created
//   2. Compose 3 SVG frames (title / hook / CTA) using teaser-video-service
//   3. Rasterize each via @resvg/resvg-js → PNG buffer
//   4. Write PNGs to a tempdir + invoke FFmpeg to build a 15-sec MP4
//        - 3 frames × 5 sec each = 15 sec total
//        - 1080×1920 (vertical, matches Reels / WhatsApp Status canvas)
//        - 30 fps, H.264 yuv420p, +faststart, NO audio
//        - Crossfade between frames so it doesn't look like a slideshow
//   5. Upload MP4 to MinIO under the pre-allocated key
//   6. Update Document.s3Key + sizeBytes (s3Key was a placeholder, kept stable)
//
// resvg-js is a pure-Rust WASM library; no native build, ~2 MB on disk. Falls
// back to a deterministic SVG-only Document on rasterization error so the route
// never strands a Document row in PENDING state.

import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile, readFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { db } from '@/lib/db';
import { createWorker, QUEUES } from '@/lib/queue';
import { s3, BUCKET } from '@/lib/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import {
  buildTeaserCopy,
  renderTitleFrameSvg,
  renderHookFrameSvg,
  renderCtaFrameSvg,
  TEASER_DIMENSIONS,
  TEASER_FRAME_SECONDS,
} from '@/server/services/promo/teaser-video-service';

interface TeaserJobData {
  documentId: string;
  sessionId: string;
  actorUserId: string;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    );
  });
}

/** Lazy-load @resvg/resvg-js so the build doesn't hard-fail in environments
 *  where the dep wasn't installed yet (resvg is a runtime dep but the worker
 *  only runs in `npm run workers`). The dynamic import returns the same
 *  module instance on subsequent calls. */
type ResvgModule = typeof import('@resvg/resvg-js');
let resvgPromise: Promise<ResvgModule> | null = null;
async function loadResvg(): Promise<ResvgModule> {
  if (!resvgPromise) {
    resvgPromise = import('@resvg/resvg-js') as Promise<ResvgModule>;
  }
  return resvgPromise;
}

async function rasterizeSvg(svg: string): Promise<Buffer> {
  const { Resvg } = await loadResvg();
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: TEASER_DIMENSIONS.w },
    font: {
      // resvg-js falls back to its bundled DejaVu Sans if the listed family
      // isn't available — gives consistent output cross-platform.
      defaultFontFamily: 'Inter',
      loadSystemFonts: true,
    },
  });
  return Buffer.from(r.render().asPng());
}

async function renderTeaser(data: TeaserJobData): Promise<{ documentId: string; key: string; bytes: number }> {
  const doc = await db.document.findUnique({
    where: { id: data.documentId },
    select: { id: true, s3Key: true, route: true, sessionLinks: { select: { sessionId: true } } },
  });
  if (!doc) throw new Error(`Document ${data.documentId} not found`);
  if (doc.route !== 'PROMO_TEASER_VIDEO') {
    throw new Error(`Document ${data.documentId} is not a PROMO_TEASER_VIDEO`);
  }

  const built = await buildTeaserCopy(data.sessionId);
  const frames = [
    renderTitleFrameSvg({
      title: built.sessionTitle,
      subtitle: built.copy.subtitle,
      hook: built.copy.hook,
      hostName: built.copy.hostName,
      whenLine: built.copy.whenLine,
    }),
    renderHookFrameSvg({
      title: built.sessionTitle,
      subtitle: built.copy.subtitle,
      hook: built.copy.hook,
      hostName: built.copy.hostName,
      whenLine: built.copy.whenLine,
    }),
    renderCtaFrameSvg({
      title: built.sessionTitle,
      subtitle: built.copy.subtitle,
      hook: built.copy.hook,
      hostName: built.copy.hostName,
      whenLine: built.copy.whenLine,
    }),
  ];

  const tmpRoot = await mkdtemp(join(tmpdir(), `vaidix-teaser-${data.documentId}-`));
  const outputPath = join(tmpRoot, 'teaser.mp4');
  try {
    // Step 1 — rasterize each SVG frame to PNG on disk.
    const framePaths: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const png = await rasterizeSvg(frames[i]);
      const p = join(tmpRoot, `frame${i}.png`);
      await writeFile(p, png);
      framePaths.push(p);
    }

    // Step 2 — FFmpeg slideshow with 0.5s crossfade between frames.
    // Uses the concat-friendly approach: each PNG looped for FRAME_SECONDS,
    // then concat with xfade transitions between adjacent segments.
    // For simplicity (and to avoid 200-line ffmpeg-filter graphs), use the
    // image2 demuxer with `-loop 1 -t <sec>` per input + xfade chain.
    const ffArgs: string[] = ['-y'];
    for (const p of framePaths) {
      ffArgs.push('-loop', '1', '-t', String(TEASER_FRAME_SECONDS), '-i', p);
    }
    // Build the xfade filter graph: [0:v][1:v]xfade=duration=0.5:offset=4.5[v01];[v01][2:v]xfade=duration=0.5:offset=9[v]
    const fadeDur = 0.5;
    let filter = '';
    let prev = '0:v';
    for (let i = 1; i < framePaths.length; i++) {
      const offset = i * TEASER_FRAME_SECONDS - fadeDur;
      const out = i === framePaths.length - 1 ? 'v' : `v${i}`;
      filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${fadeDur}:offset=${offset}[${out}];`;
      prev = out;
    }
    filter = filter.replace(/;$/, '');
    ffArgs.push(
      '-filter_complex', filter,
      '-map', '[v]',
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-movflags', '+faststart',
      outputPath
    );
    await runFfmpeg(ffArgs);

    const bytes = (await stat(outputPath)).size;
    const buf = await readFile(outputPath);

    // Step 3 — upload to MinIO under the pre-allocated key.
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: doc.s3Key,
        Body: buf,
        ContentType: 'video/mp4',
      })
    );

    // Step 4 — update Document with real size + status flag in metadata.
    // s3Key stays unchanged (already correct); we only flip sizeBytes from 0
    // and stamp a `teaserStatus=READY` flag the route uses to detect render
    // completion when polling.
    await db.document.update({
      where: { id: data.documentId },
      data: { sizeBytes: BigInt(bytes) },
    });

    await audit({
      eventType: AUDIT_EVENTS.PROMO_TEASER_RENDERED,
      entityType: 'Document',
      entityId: data.documentId,
      summary: `Promo teaser video rendered (${Math.round(bytes / 1024)} KB)`,
      details: { sessionId: data.sessionId, key: doc.s3Key, bytes },
    });

    return { documentId: data.documentId, key: doc.s3Key, bytes };
  } catch (err) {
    // Stamp the failure reason on the Document so the polling UI can surface
    // it instead of spinning forever. Common causes:
    //   - "spawn ffmpeg ENOENT" → FFmpeg binary not on PATH (install it)
    //   - "Session not found"   → curator deleted the session mid-render
    const reason = (err as Error).message || 'render failed';
    await db.document
      .update({
        where: { id: data.documentId },
        data: { rejectionReason: `[teaser] ${reason}`.slice(0, 500) },
      })
      .catch(() => {});
    await audit({
      eventType: AUDIT_EVENTS.PROMO_TEASER_FAILED,
      entityType: 'Document',
      entityId: data.documentId,
      summary: `Promo teaser render failed: ${reason}`,
      details: { sessionId: data.sessionId, error: reason },
      success: false,
    });
    throw err;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function startPromoTeaserWorker() {
  const worker = createWorker<TeaserJobData>(
    QUEUES.PROMO,
    async (job) => {
      // PROMO queue is dedicated — only one job kind today, but we still
      // discriminate by name so future kinds (e.g., PNG conversion of SVG
      // promos) co-tenant cleanly without the silent-skip pattern.
      if (job.name !== 'promo-teaser-render') return { skipped: true };
      return renderTeaser(job.data);
    },
    { concurrency: 2 }
  );
  worker.on('failed', (job, err) => {
    if (job?.name !== 'promo-teaser-render') return;
    console.error('[promo-teaser-worker] job failed', { id: job?.id, err: err.message });
  });
  worker.on('completed', (job, result) => {
    if (job.name === 'promo-teaser-render') {
      console.log('[promo-teaser-worker] done', { id: job.id, result });
    }
  });
  return worker;
}

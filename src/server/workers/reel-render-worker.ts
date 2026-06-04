// ════════════════════════════════════════════════════════════════════════════
// Reel Render Worker — Stream A8
// ════════════════════════════════════════════════════════════════════════════
// Consumes 'reel-render' jobs from the RECORDING queue. For each Clip with
// kind=REEL: downloads source MP4, runs FFmpeg to extract the [start,end]
// window, vertical-crop to 1080×1920, re-encode (H.264 + AAC), upload to
// MinIO under clips/{sessionId}/{clipId}.mp4, then update Clip.s3Key.

import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { db } from '@/lib/db';
import { createWorker, QUEUES } from '@/lib/queue';
import { presignDownload, s3, BUCKET } from '@/lib/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';

interface ReelJobData {
  clipId: string;
}

interface ReelOnlyJob extends ReelJobData {
  kind?: 'reel-render';
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

async function renderReel(data: ReelJobData): Promise<{ clipId: string; key: string }> {
  const clip = await db.clip.findUnique({
    where: { id: data.clipId },
    include: { recording: { select: { sessionId: true, rawS3Key: true } } },
  });
  if (!clip) throw new Error(`Clip ${data.clipId} not found`);
  if (clip.kind !== 'REEL') throw new Error(`Clip ${data.clipId} is not a REEL`);
  if (!clip.recording.rawS3Key) throw new Error('Source recording has no rawS3Key yet');

  const sessionId = clip.recording.sessionId;
  const tmpRoot = await mkdtemp(join(tmpdir(), `vaidix-reel-${data.clipId}-`));
  const inputPath = join(tmpRoot, 'input.mp4');
  const outputPath = join(tmpRoot, 'reel.mp4');

  try {
    // 1. Download source MP4
    const url = await presignDownload(clip.recording.rawS3Key, 3600);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch source: ${res.status}`);
    await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

    // 2. FFmpeg: trim + vertical 1080x1920 (center-crop wide source).
    //    -ss before -i is fast-seek; re-encode required for clean trim + filter.
    const duration = clip.endSec - clip.startSec;
    await runFfmpeg([
      '-y',
      '-ss', String(clip.startSec),
      '-i', inputPath,
      '-t', String(duration),
      '-vf', "scale='if(gt(a,9/16),-2,1080)':'if(gt(a,9/16),1920,-2)',crop=1080:1920",
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ]);

    // 3. Upload to MinIO
    const key = `clips/${sessionId}/${data.clipId}.mp4`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: await readFile(outputPath),
        ContentType: 'video/mp4',
      })
    );

    // 4. Update clip
    await db.clip.update({
      where: { id: data.clipId },
      data: { s3Key: key },
    });

    await audit({
      eventType: AUDIT_EVENTS.RECORDING_TRANSCODE_DONE, // reuses the closest signal
      entityType: 'Clip',
      entityId: data.clipId,
      summary: `Reel render complete (${duration}s)`,
      details: { sessionId, clipId: data.clipId, key, durationSec: duration },
    });

    return { clipId: data.clipId, key };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function startReelRenderWorker() {
  const worker = createWorker<ReelOnlyJob>(
    QUEUES.RECORDING,
    async (job) => {
      // Co-tenants the RECORDING queue with the transcode job. BullMQ assigns
      // each job to exactly ONE worker — returning success on a foreign job
      // would lose it (transcode-worker never sees). Throw so BullMQ retries
      // and the sibling worker eventually picks it up.
      if (job.name !== 'reel-render') {
        throw new Error(`Not my job (name=${job.name}); retrying for sibling worker`);
      }
      return renderReel(job.data);
    },
    { concurrency: 2 }
  );
  worker.on('failed', async (job, err) => {
    if (job?.name !== 'reel-render') return;
    console.error('[reel-render-worker] job failed', { id: job?.id, err: err.message });
  });
  worker.on('completed', (job, result) => {
    if (job.name === 'reel-render') console.log('[reel-render-worker] done', { id: job.id, result });
  });
  return worker;
}

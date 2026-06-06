// ════════════════════════════════════════════════════════════════════════════
// Transcode Worker
// ════════════════════════════════════════════════════════════════════════════
// Consumes RECORDING queue jobs:
//   { recordingId } → downloads raw MP4 from MinIO → FFmpeg multi-bitrate HLS
//   → uploads HLS segments + master.m3u8 back to MinIO under hls/{sessionId}/
//   → updates Recording (status=TRANSCRIBING, hlsPath, durationSec)
//   → enqueues TRANSCRIBE job
//
// FFmpeg is invoked as a child process. Production: FFmpeg installed on the
// worker host. For LVPEI on-prem, runs alongside Node in the same container.

import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { db } from '@/lib/db';
import { createWorker, getQueue, QUEUES } from '@/lib/queue';
import { presignDownload, s3, RECORDINGS_BUCKET } from '@/lib/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { RecordingStatus } from '@prisma/client';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';

interface TranscodeJobData {
  recordingId: string;
}

const HLS_LADDER = [
  { name: '1080p', height: 1080, vBitrate: '5000k', aBitrate: '192k' },
  { name: '720p',  height: 720,  vBitrate: '2800k', aBitrate: '128k' },
  { name: '480p',  height: 480,  vBitrate: '1400k', aBitrate: '128k' },
  { name: '360p',  height: 360,  vBitrate: '800k',  aBitrate: '96k'  },
  { name: '240p',  height: 240,  vBitrate: '400k',  aBitrate: '64k'  },
];

// Resolve the ffmpeg binary at startup. Production Linux servers should
// install ffmpeg via apt-get and have it on $PATH; local dev (Windows / Mac)
// falls back to the cross-platform ffmpeg-static binary bundled in node_modules.
// FFMPEG_PATH env var lets ops override (e.g. point to a custom build with
// hardware encoders enabled).
const FFMPEG_BIN: string = process.env.FFMPEG_PATH ?? ffmpegStatic ?? 'ffmpeg';

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

interface ProbeResult {
  hasVideo: boolean;
  durationSec: number | null;
}

/**
 * Probe an MP4 with ffmpeg to determine:
 *   - Whether it contains a video stream (decides audio-only vs full HLS ladder)
 *   - The actual duration in seconds (authoritative source of truth — not the
 *     egress webhook duration field which is sometimes absent or nanosecond-encoded)
 *
 * Uses `ffmpeg -i` (stderr info mode) instead of ffprobe so no extra binary
 * is needed. ffmpeg always exits non-zero in this mode; we parse stderr regardless.
 */
async function probeInput(inputPath: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(FFMPEG_BIN, ['-hide_banner', '-i', inputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', () => {
      const hasVideo = /Stream #\d+:\d+(?:\([^)]*\))?: Video/i.test(stderr);
      // "Duration: HH:MM:SS.ss," — ffmpeg always prints this for valid media
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const durationSec = m
        ? Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
        : null;
      resolve({ hasVideo, durationSec });
    });
    child.on('error', () => resolve({ hasVideo: false, durationSec: null }));
  });
}

async function uploadDirectory(localDir: string, keyPrefix: string): Promise<void> {
  const entries = await readdir(localDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const localPath = join(localDir, e.name);
    const buf = await readFile(localPath);
    const ct = e.name.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : e.name.endsWith('.ts')
        ? 'video/mp2t'
        : 'application/octet-stream';
    await s3.send(
      new PutObjectCommand({
        Bucket: RECORDINGS_BUCKET,
        Key: `${keyPrefix}/${e.name}`,
        Body: buf,
        ContentType: ct,
      })
    );
  }
}

async function transcodeJob(data: TranscodeJobData): Promise<{ recordingId: string; hlsPath: string }> {
  const recording = await db.recording.findUnique({ where: { id: data.recordingId } });
  if (!recording) throw new Error(`Recording ${data.recordingId} not found`);
  if (!recording.rawS3Key) throw new Error(`Recording ${data.recordingId} has no rawS3Key`);

  const sessionId = recording.sessionId;
  const tmpRoot = await mkdtemp(join(tmpdir(), `vaidix-transcode-${data.recordingId}-`));
  const inputPath = join(tmpRoot, 'input.mp4');
  const hlsDir = join(tmpRoot, 'hls');
  await rm(hlsDir, { recursive: true, force: true });

  try {
    // 1. Download raw MP4 to tmp
    const url = await presignDownload(recording.rawS3Key, 3600, RECORDINGS_BUCKET);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch raw MP4: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(inputPath, buf);

    // 2. Probe the input — audio-only egress recordings (recordingEnabled
    //    sessions where no one starts video) have no video stream.
    // Also captures the authoritative duration — the egress webhook duration
    // field is often absent or nanosecond-encoded incorrectly.
    const { hasVideo, durationSec: probedDurationSec } = await probeInput(inputPath);

    // Ensure the HLS output dir exists; FFmpeg won't create deep paths on its own.
    await rm(hlsDir, { recursive: true, force: true });
    const { mkdir } = await import('fs/promises');
    await mkdir(hlsDir, { recursive: true });

    if (hasVideo) {
      // Multi-variant video+audio HLS ladder.
      const variantArgs: string[] = [];
      const masterEntries: string[] = [];
      HLS_LADDER.forEach((rung, idx) => {
        variantArgs.push(
          '-map', '0:v:0', '-map', '0:a:0?',
          `-c:v:${idx}`, 'libx264', `-b:v:${idx}`, rung.vBitrate,
          `-maxrate:v:${idx}`, rung.vBitrate, `-bufsize:v:${idx}`, rung.vBitrate,
          `-vf:${idx}`, `scale=-2:${rung.height}`,
          `-c:a:${idx}`, 'aac', `-b:a:${idx}`, rung.aBitrate
        );
        masterEntries.push(`v:${idx},a:${idx}`);
      });
      await runFfmpeg([
        '-i', inputPath,
        ...variantArgs,
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_filename', join(hlsDir, 'v%v_seg_%05d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', masterEntries.join(' '),
        join(hlsDir, 'v%v_playlist.m3u8'),
      ]);
    } else {
      // Audio-only single-variant HLS. The "ladder" collapses to one stream.
      // Producing a master.m3u8 anyway so the player can load `master.m3u8`
      // uniformly regardless of media type.
      await runFfmpeg([
        '-i', inputPath,
        '-map', '0:a:0',
        '-c:a', 'aac', '-b:a', '128k',
        '-vn', // explicitly drop any video
        '-f', 'hls',
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_segment_filename', join(hlsDir, 'audio_seg_%05d.ts'),
        join(hlsDir, 'audio_playlist.m3u8'),
      ]);
      // Hand-write a master.m3u8 that references the single audio variant.
      const master = [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"',
        'audio_playlist.m3u8',
        '',
      ].join('\n');
      await writeFile(join(hlsDir, 'master.m3u8'), master);
    }

    // 3. Upload entire hlsDir tree to MinIO under hls/{sessionId}/
    const hlsKeyPrefix = `hls/${sessionId}`;
    // Walk one level deep; FFmpeg's flat output puts everything in hlsDir.
    const topEntries = await readdir(hlsDir, { withFileTypes: true });
    for (const e of topEntries) {
      const p = join(hlsDir, e.name);
      if (e.isDirectory()) {
        await uploadDirectory(p, `${hlsKeyPrefix}/${e.name}`);
      } else {
        const buf2 = await readFile(p);
        const ct = e.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await s3.send(
          new PutObjectCommand({
            Bucket: RECORDINGS_BUCKET,
            Key: `${hlsKeyPrefix}/${e.name}`,
            Body: buf2,
            ContentType: ct,
          })
        );
      }
    }
    const hlsPath = `${hlsKeyPrefix}/master.m3u8`;

    // 4. Mark recording transcribing + enqueue transcribe.
    // Always persist probedDurationSec — it's authoritative (from the actual MP4
    // file). The egress webhook may have set durationSec already, but it can be
    // wrong (LiveKit sometimes reports duration in nanoseconds or omits it).
    await db.recording.update({
      where: { id: recording.id },
      data: {
        hlsPath,
        ...(probedDurationSec != null ? { durationSec: probedDurationSec } : {}),
        status: RecordingStatus.TRANSCRIBING,
        pipelineStage: RecordingStatus.TRANSCRIBING,
        transcodeFinishedAt: new Date(),
        transcribeStartedAt: new Date(),
      },
    });
    await db.recordingStageEvent.create({
      data: {
        recordingId: recording.id,
        stage: RecordingStatus.TRANSCRIBING,
        metadata: { variants: HLS_LADDER.map((r) => r.name), hlsPath },
      },
    });
    await getQueue(QUEUES.TRANSCRIBE).add(
      'transcribe',
      { recordingId: recording.id },
      { jobId: `transcribe-${recording.id}` }
    );
    await audit({
      eventType: AUDIT_EVENTS.RECORDING_TRANSCODE_DONE,
      entityType: 'Recording',
      entityId: recording.id,
      summary: 'Transcode complete; transcribe enqueued',
      details: { sessionId, hlsPath, variants: HLS_LADDER.map((v) => v.name) },
    });

    return { recordingId: recording.id, hlsPath };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function startTranscodeWorker() {
  const worker = createWorker<TranscodeJobData>(
    QUEUES.RECORDING,
    async (job) => {
      // Co-tenant queue: 'transcode' (this) and 'reel-render' (reel-render-worker).
      // BullMQ assigns each job to exactly ONE worker. If we returned a value
      // here for a non-transcode job, BullMQ would mark it complete and the
      // reel-render-worker would never see it — losing the job. Throw instead
      // so BullMQ retries, giving the other worker a chance to pick it up.
      // (Both workers do this dance until the right one acks the job.)
      if (job.name !== 'transcode') {
        throw new Error(`Not my job (name=${job.name}); retrying for sibling worker`);
      }
      return transcodeJob(job.data);
    },
    { concurrency: 1 } // FFmpeg is CPU-heavy — keep low
  );
  worker.on('failed', async (job, err) => {
    if (job?.name !== 'transcode') return;
    console.error('[transcode-worker] job failed', { id: job?.id, err: err.message });
    if (job?.data?.recordingId) {
      await db.recording
        .update({
          where: { id: job.data.recordingId },
          data: {
            status: RecordingStatus.TRANSCODING_FAILED,
            pipelineStage: RecordingStatus.TRANSCODING_FAILED,
            failureReason: err.message.slice(0, 1000),
            retryCount: { increment: 1 },
          },
        })
        .catch(() => {});
    }
  });
  worker.on('completed', (job, result) => {
    if (job.name === 'transcode') console.log('[transcode-worker] done', { id: job.id, result });
  });
  return worker;
}

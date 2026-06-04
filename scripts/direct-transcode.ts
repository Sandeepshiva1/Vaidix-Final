// Direct transcode — runs the transcode pipeline inline, bypassing BullMQ.
// Use when a job is stuck in DLQ due to the co-tenant queue race.
// Usage: tsx --env-file=.env.local --env-file=.env scripts/direct-transcode.ts <recordingId>

import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { db } from '../src/lib/db';
import { presignDownload, s3, BUCKET } from '../src/lib/storage';
import { getQueue, QUEUES } from '../src/lib/queue';
import { RecordingStatus } from '@prisma/client';

const FFMPEG_BIN: string = process.env.FFMPEG_PATH ?? ffmpegStatic ?? 'ffmpeg';
const HLS_LADDER = [
  { name: '1080p', height: 1080, vBitrate: '5000k', aBitrate: '192k' },
  { name: '720p',  height: 720,  vBitrate: '2800k', aBitrate: '128k' },
  { name: '480p',  height: 480,  vBitrate: '1400k', aBitrate: '128k' },
  { name: '360p',  height: 360,  vBitrate: '800k',  aBitrate: '96k'  },
  { name: '240p',  height: 240,  vBitrate: '400k',  aBitrate: '64k'  },
];

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  $ ${FFMPEG_BIN} ${args.slice(0, 6).join(' ')} ...`);
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
  });
}

async function probeHasVideo(inputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(FFMPEG_BIN, ['-hide_banner', '-i', inputPath, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('exit', () => resolve(/Stream #\d+:\d+(?:\([^)]*\))?: Video/i.test(stderr)));
    child.on('error', () => resolve(false));
  });
}

async function uploadDir(dir: string, prefix: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const buf = await readFile(join(dir, e.name));
    const ct = e.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : e.name.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream';
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${prefix}/${e.name}`, Body: buf, ContentType: ct }));
  }
}

async function main() {
  const recordingId = process.argv[2];
  if (!recordingId) { console.error('usage: tsx scripts/direct-transcode.ts <recordingId>'); process.exit(1); }

  const recording = await db.recording.findUnique({ where: { id: recordingId } });
  if (!recording) { console.error('Recording not found'); process.exit(1); }
  if (!recording.rawS3Key) { console.error('No rawS3Key'); process.exit(1); }

  console.log(`\nTranscoding recording ${recordingId}`);
  console.log(`  rawS3Key: ${recording.rawS3Key}`);

  const tmpRoot = await mkdtemp(join(tmpdir(), `vaidix-direct-transcode-${recordingId}-`));
  const inputPath = join(tmpRoot, 'input.mp4');
  const hlsDir = join(tmpRoot, 'hls');

  try {
    console.log('  Downloading raw MP4 from MinIO...');
    const url = await presignDownload(recording.rawS3Key, 3600);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
    await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));
    console.log('  Downloaded.');

    await rm(hlsDir, { recursive: true, force: true });
    await mkdir(hlsDir, { recursive: true });

    const hasVideo = await probeHasVideo(inputPath);
    console.log(`  Has video stream: ${hasVideo}`);

    const hlsKeyPrefix = `hls/${recording.sessionId}`;

    if (hasVideo) {
      const variantArgs: string[] = [];
      const masterEntries: string[] = [];
      HLS_LADDER.forEach((rung, idx) => {
        variantArgs.push('-map', '0:v:0', '-map', '0:a:0?', `-c:v:${idx}`, 'libx264', `-b:v:${idx}`, rung.vBitrate, `-maxrate:v:${idx}`, rung.vBitrate, `-bufsize:v:${idx}`, rung.vBitrate, `-vf:${idx}`, `scale=-2:${rung.height}`, `-c:a:${idx}`, 'aac', `-b:a:${idx}`, rung.aBitrate);
        masterEntries.push(`v:${idx},a:${idx}`);
      });
      console.log('  Running FFmpeg multi-bitrate HLS...');
      await run(['-i', inputPath, ...variantArgs, '-f', 'hls', '-hls_time', '6', '-hls_list_size', '0', '-hls_segment_filename', join(hlsDir, 'v%v_seg_%05d.ts'), '-master_pl_name', 'master.m3u8', '-var_stream_map', masterEntries.join(' '), join(hlsDir, 'v%v_playlist.m3u8')]);
    } else {
      console.log('  Running FFmpeg audio-only HLS...');
      await run(['-i', inputPath, '-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-vn', '-f', 'hls', '-hls_time', '10', '-hls_list_size', '0', '-hls_segment_filename', join(hlsDir, 'audio_seg_%05d.ts'), join(hlsDir, 'audio_playlist.m3u8')]);
      await writeFile(join(hlsDir, 'master.m3u8'), ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"', 'audio_playlist.m3u8', ''].join('\n'));
    }

    console.log('  Uploading HLS to MinIO...');
    const topEntries = await readdir(hlsDir, { withFileTypes: true });
    for (const e of topEntries) {
      const p = join(hlsDir, e.name);
      if (e.isDirectory()) {
        await uploadDir(p, `${hlsKeyPrefix}/${e.name}`);
      } else {
        const buf = await readFile(p);
        const ct = e.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${hlsKeyPrefix}/${e.name}`, Body: buf, ContentType: ct }));
      }
    }
    const hlsPath = `${hlsKeyPrefix}/master.m3u8`;
    console.log(`  HLS uploaded → ${hlsPath}`);

    await db.recording.update({
      where: { id: recordingId },
      data: { hlsPath, status: RecordingStatus.TRANSCRIBING, pipelineStage: RecordingStatus.TRANSCRIBING, transcodeFinishedAt: new Date(), transcribeStartedAt: new Date() },
    });

    const q = getQueue(QUEUES.TRANSCRIBE);
    const job = await q.add('transcribe', { recordingId }, { jobId: `direct-transcribe-${recordingId}-${Date.now()}` });
    await q.close();
    console.log(`  Transcribe job queued: ${job.id}`);
    console.log('\nDone. The recording is now TRANSCRIBING — captions will be added shortly.');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }

  await db.$disconnect();
  process.exit(0);
}

void main();

// ════════════════════════════════════════════════════════════════════════════
// Transcribe Worker
// ════════════════════════════════════════════════════════════════════════════
// Consumes TRANSCRIBE queue jobs:
//   { recordingId } → extracts audio (WAV) from raw MP4 in MinIO
//                  → calls TranscriptionProvider (Sarvam or self-hosted)
//                  → writes Transcript rows (one per language)
//                  → uploads VTT files to MinIO under captions/{sessionId}/
//                  → marks Recording READY (or AI_PROCESSING if pearl-extract follows)

import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { db } from '@/lib/db';
import { createWorker, QUEUES } from '@/lib/queue';
import { presignDownload, presignUpload, s3, BUCKET } from '@/lib/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { RecordingStatus } from '@prisma/client';
import { getTranscriptionProvider, type TranscriptionResult, type TranscriptionSegment } from '@/server/services/transcription';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { emit } from '@/server/services/notifications-service';

interface TranscribeJobData {
  recordingId: string;
}

const FFMPEG_BIN: string = process.env.FFMPEG_PATH ?? ffmpegStatic ?? 'ffmpeg';

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

function pad(n: number, w = 2): string {
  return n.toString().padStart(w, '0');
}

function formatVttTimestamp(sec: number): string {
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const s = Math.floor(sec) % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function buildVtt(segments: TranscriptionSegment[], pickText: (s: TranscriptionSegment) => string): string {
  const lines = ['WEBVTT', ''];
  for (const seg of segments) {
    const start = formatVttTimestamp(seg.startSec);
    const end = formatVttTimestamp(Math.max(seg.endSec, seg.startSec + 0.5));
    const speaker = seg.speaker ? `<v ${seg.speaker}>` : '';
    const text = pickText(seg).replace(/\n+/g, ' ').trim();
    if (!text) continue;
    lines.push(`${start} --> ${end}`);
    lines.push(`${speaker}${text}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function uploadVtt(sessionId: string, name: string, body: string): Promise<string> {
  const key = `captions/${sessionId}/${name}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'text/vtt; charset=utf-8',
    })
  );
  return key;
}

async function transcribeJob(data: TranscribeJobData): Promise<{ recordingId: string; provider: string }> {
  const recording = await db.recording.findUnique({ where: { id: data.recordingId } });
  if (!recording) throw new Error(`Recording ${data.recordingId} not found`);
  if (!recording.rawS3Key) throw new Error(`Recording ${data.recordingId} has no rawS3Key`);

  const tmpRoot = await mkdtemp(join(tmpdir(), `vaidix-transcribe-${data.recordingId}-`));
  const inputPath = join(tmpRoot, 'input.mp4');
  const audioPath = join(tmpRoot, 'audio.wav');

  try {
    // 1. Download raw MP4
    const rawUrl = await presignDownload(recording.rawS3Key, 3600);
    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error(`Failed to fetch raw MP4: ${res.status}`);
    await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

    // 2. Extract mono 16kHz WAV (best for both Sarvam and Whisper).
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'wav',
      audioPath,
    ]);

    // 3. Upload audio to MinIO so the provider can fetch by URL.
    const audioKey = `audio/${recording.sessionId}/${recording.id}.wav`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: audioKey,
        Body: await readFile(audioPath),
        ContentType: 'audio/wav',
      })
    );
    const audioUrl = await presignUpload(audioKey, 'audio/wav', 60).then(() => presignDownload(audioKey, 3600));

    // 4. Call the configured provider.
    const provider = getTranscriptionProvider();
    const result: TranscriptionResult = await provider.transcribe({
      audioUrl,
      languageHint: 'auto',
      diarize: provider.name === 'self_hosted', // Sarvam real-time API rejects diarization
      initialPrompt:
        'Ophthalmology lecture. Common terms: PDR, NVG, OCT, anti-VEGF, ranibizumab, aflibercept, vitrectomy, fundus, retina, glaucoma, DALK, PKP.',
    });

    // 5. Persist Transcript rows + VTT artifacts.
    const groupedByLang = new Map<string, TranscriptionSegment[]>();
    for (const seg of result.segments) {
      const lang = seg.lang || (result.detectedLanguage?.slice(0, 2) ?? 'en');
      const arr = groupedByLang.get(lang) ?? [];
      arr.push(seg);
      groupedByLang.set(lang, arr);
    }

    // Original-language transcript(s) — one Transcript row per detected language.
    for (const [lang, segs] of groupedByLang) {
      const vttBody = buildVtt(segs, (s) => s.text);
      await uploadVtt(recording.sessionId, `${lang}.vtt`, vttBody);
      await db.transcript.upsert({
        where: { recordingId_language: { recordingId: recording.id, language: lang } },
        create: {
          recordingId: recording.id,
          language: lang,
          source: result.provider,
          content: segs.map((s) => s.text).join(' ').trim(),
          segments: segs as unknown as object,
          diarized: segs.some((s) => !!s.speaker),
          piiRedacted: false, // Phase A: no PHI sanitizer yet — Stream C C5 wires Presidio
        },
        update: {
          source: result.provider,
          content: segs.map((s) => s.text).join(' ').trim(),
          segments: segs as unknown as object,
          diarized: segs.some((s) => !!s.speaker),
        },
      });
    }

    // English translation track (always emit if not pure English).
    const hasNonEnglish = [...groupedByLang.keys()].some((l) => l !== 'en');
    if (hasNonEnglish) {
      const enVtt = buildVtt(result.segments, (s) => s.textEn ?? s.text);
      await uploadVtt(recording.sessionId, 'en.vtt', enVtt);
      await db.transcript.upsert({
        where: { recordingId_language: { recordingId: recording.id, language: 'en' } },
        create: {
          recordingId: recording.id,
          language: 'en',
          source: `${result.provider}-translated`,
          content: result.fullTextEn,
          segments: result.segments as unknown as object,
          diarized: result.segments.some((s) => !!s.speaker),
          piiRedacted: false,
        },
        update: {
          source: `${result.provider}-translated`,
          content: result.fullTextEn,
          segments: result.segments as unknown as object,
        },
      });
    }

    // 6. Mark recording ready (AI post-processing — pearl extraction — is future work).
    await db.recording.update({
      where: { id: recording.id },
      data: {
        status: RecordingStatus.READY,
        pipelineStage: RecordingStatus.READY,
        transcribeFinishedAt: new Date(),
        durationSec: recording.durationSec ?? (Math.round(result.durationSec) || null),
      },
    });
    await db.recordingStageEvent.create({
      data: {
        recordingId: recording.id,
        stage: RecordingStatus.READY,
        metadata: {
          provider: result.provider,
          segmentCount: result.segments.length,
          processingMs: result.processingMs,
          languages: [...groupedByLang.keys()],
        },
      },
    });
    await audit({
      eventType: AUDIT_EVENTS.RECORDING_TRANSCRIBE_DONE,
      entityType: 'Recording',
      entityId: recording.id,
      summary: `Transcribed via ${result.provider}; ${result.segments.length} segments`,
      details: {
        sessionId: recording.sessionId,
        provider: result.provider,
        segmentCount: result.segments.length,
        processingMs: result.processingMs,
        languages: [...groupedByLang.keys()],
      },
    });

    // Notify the session host that the recording and transcript are ready.
    const sessionRow = await db.teachingSession.findUnique({
      where: { id: recording.sessionId },
      select: { title: true, hostId: true, host: { select: { status: true } } },
    });
    if (sessionRow && sessionRow.host.status === 'ACTIVE') {
      await emit({
        userId: sessionRow.hostId,
        kind: 'recording.ready',
        title: `Recording & transcript ready: ${sessionRow.title}`,
        body: `${result.segments.length} segments transcribed via ${result.provider}`,
        payload: {
          sessionId: recording.sessionId,
          recordingId: recording.id,
          provider: result.provider,
        },
      });
    }

    return { recordingId: recording.id, provider: result.provider };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function startTranscribeWorker() {
  const worker = createWorker<TranscribeJobData>(
    QUEUES.TRANSCRIBE,
    async (job) => transcribeJob(job.data),
    { concurrency: 2 }
  );
  worker.on('failed', async (job, err) => {
    console.error('[transcribe-worker] job failed', { id: job?.id, err: err.message });
    if (job?.data?.recordingId) {
      await db.recording
        .update({
          where: { id: job.data.recordingId },
          data: {
            status: RecordingStatus.TRANSCRIBING_FAILED,
            pipelineStage: RecordingStatus.TRANSCRIBING_FAILED,
            failureReason: err.message.slice(0, 1000),
            retryCount: { increment: 1 },
          },
        })
        .catch(() => {});
    }
  });
  worker.on('completed', (job, result) => {
    console.log('[transcribe-worker] done', { id: job.id, result });
  });
  return worker;
}

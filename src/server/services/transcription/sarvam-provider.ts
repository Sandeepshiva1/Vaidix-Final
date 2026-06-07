// ════════════════════════════════════════════════════════════════════════════
// Sarvam Saaras transcription — testing/showcase provider only.
// ════════════════════════════════════════════════════════════════════════════
// Production env gate (src/lib/env.ts) prevents this from running in prod.
// Synthetic / consented data only. See the video architecture notes

import { env } from '@/lib/env';
import type {
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
} from './transcription-provider';

const SARVAM_ENDPOINT = 'https://api.sarvam.ai/speech-to-text-translate';

interface SarvamResponse {
  /** Full transcript */
  transcript: string;
  /** Per-segment diarization output (Sarvam returns its own diarization) */
  diarized_transcript?: {
    entries?: Array<{
      speaker_id?: string;
      transcript?: string;
      start_time_seconds?: number;
      end_time_seconds?: number;
    }>;
  };
  language_code?: string;
  request_id?: string;
}

export class SarvamTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'sarvam' as const;

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!env.SARVAM_API_KEY) {
      throw new Error(
        'SarvamTranscriptionProvider: SARVAM_API_KEY is not set. Either set it (dev/test only) or switch to self_hosted.'
      );
    }
    const startWall = Date.now();

    // Sarvam expects the audio file uploaded as multipart. We download from
    // S3/MinIO via the presigned URL, then stream to Sarvam.
    const audioRes = await fetch(input.audioUrl);
    if (!audioRes.ok) {
      throw new Error(`Failed to fetch audio for transcription: ${audioRes.status}`);
    }
    const audioBlob = await audioRes.blob();

    const form = new FormData();
    form.append('file', audioBlob, 'audio.wav');
    form.append('model', env.SARVAM_STT_MODEL);
    form.append('with_diarization', input.diarize === false ? 'false' : 'true');
    form.append('with_timestamps', 'true');
    if (input.languageHint && input.languageHint !== 'auto') {
      form.append('language_code', `${input.languageHint}-IN`);
    }

    const res = await fetch(SARVAM_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-subscription-key': env.SARVAM_API_KEY,
      },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sarvam API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as SarvamResponse;
    const segments: TranscriptionSegment[] = (json.diarized_transcript?.entries ?? []).map(
      (e) => ({
        startSec: e.start_time_seconds ?? 0,
        endSec: e.end_time_seconds ?? 0,
        text: e.transcript ?? '',
        lang: json.language_code?.slice(0, 2) ?? 'en',
        textEn: undefined, // Sarvam Saaras returns translated text in `transcript` already
        speaker: e.speaker_id,
      })
    );

    // If Sarvam didn't return diarized segments, fall back to a single segment.
    // Estimate duration from word count (~130 wpm average speaking pace).
    if (segments.length === 0 && json.transcript) {
      const wordCount = json.transcript.trim().split(/\s+/).length;
      const estimatedEndSec = Math.max(1, Math.round((wordCount / 130) * 60));
      segments.push({
        startSec: 0,
        endSec: estimatedEndSec,
        text: json.transcript,
        lang: json.language_code?.slice(0, 2) ?? 'en',
      });
    }

    const fullText = segments.map((s) => s.text).join(' ').trim();

    return {
      provider: 'sarvam',
      segments,
      fullText,
      // Sarvam Saaras translates inline; treat full text as English equivalent for now.
      fullTextEn: fullText,
      detectedLanguage: json.language_code,
      durationSec: segments.at(-1)?.endSec ?? 0,
      processingMs: Date.now() - startWall,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Self-hosted transcription — calls a Python sidecar service running
// Faster-Whisper + AI4Bharat IndicConformer + pyannote on the LVPEI GPU.
// ════════════════════════════════════════════════════════════════════════════
// The Python service is deployed separately (Docker container on the GPU
// instance). This adapter calls it over internal HTTP. Contract:
//
//   POST {SELF_HOSTED_TRANSCRIPTION_URL}/transcribe
//   Body: { audioUrl, languageHint, diarize, initialPrompt }
//   Response: same TranscriptionResult shape.
//
// Until the Python service is deployed, this throws a clear error so callers
// know to either wire the service or switch to TRANSCRIPTION_PROVIDER=sarvam
// for dev work.

import { env } from '@/lib/env';
import type {
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
} from './transcription-provider';

export class SelfHostedTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'self_hosted' as const;

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!env.SELF_HOSTED_TRANSCRIPTION_URL) {
      throw new Error(
        'SelfHostedTranscriptionProvider: SELF_HOSTED_TRANSCRIPTION_URL is not set. ' +
          'Either deploy the Python sidecar (Faster-Whisper + IndicConformer + pyannote) ' +
          'and set the URL, or use TRANSCRIPTION_PROVIDER=sarvam for dev (forbidden in prod).'
      );
    }
    const url = env.SELF_HOSTED_TRANSCRIPTION_URL.replace(/\/$/, '') + '/transcribe';
    const startWall = Date.now();

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioUrl: input.audioUrl,
        languageHint: input.languageHint ?? 'auto',
        diarize: input.diarize ?? true,
        initialPrompt: input.initialPrompt,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Self-hosted transcription error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as Omit<TranscriptionResult, 'provider' | 'processingMs'>;

    return {
      ...data,
      provider: 'self_hosted',
      processingMs: Date.now() - startWall,
    };
  }
}

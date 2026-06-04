// ════════════════════════════════════════════════════════════════════════════
// TranscriptionProvider selector
// ════════════════════════════════════════════════════════════════════════════
// Single entry point. Reads TRANSCRIPTION_PROVIDER env var and returns the
// matching adapter. The transcribe BullMQ worker calls this — never imports
// concrete providers directly.

import { env } from '@/lib/env';
import { SarvamTranscriptionProvider } from './sarvam-provider';
import { SelfHostedTranscriptionProvider } from './self-hosted-provider';
import type { TranscriptionProvider } from './transcription-provider';

let cachedProvider: TranscriptionProvider | null = null;

export function getTranscriptionProvider(): TranscriptionProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider =
    env.TRANSCRIPTION_PROVIDER === 'self_hosted'
      ? new SelfHostedTranscriptionProvider()
      : new SarvamTranscriptionProvider();
  return cachedProvider;
}

// Test/dev helper — clear cache (e.g., between tests if env var changes).
export function _resetTranscriptionProviderCache(): void {
  cachedProvider = null;
}

export type { TranscriptionProvider, TranscriptionInput, TranscriptionResult, TranscriptionSegment } from './transcription-provider';

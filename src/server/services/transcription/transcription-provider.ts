// ════════════════════════════════════════════════════════════════════════════
// TranscriptionProvider — common interface for Sarvam and self-hosted Whisper.
// ════════════════════════════════════════════════════════════════════════════
// W4-Sprint Stream B foundation. The transcribe BullMQ worker calls
// getTranscriptionProvider().transcribe(...) — knows nothing about which
// implementation runs. Cutover to LVPEI on-prem self-hosted = env var flip
// + restart, enforced by the production env gate in src/lib/env.ts.

export type TranscriptionLanguageHint =
  | 'auto'        // detect per segment
  | 'en'          // English
  | 'hi'          // Hindi
  | 'te'          // Telugu
  | 'ta'          // Tamil
  | 'kn'          // Kannada
  | 'ml'          // Malayalam
  | 'mr'          // Marathi
  | 'bn'          // Bengali
  | 'ur';         // Urdu

export interface TranscriptionSegment {
  /** Segment start time in seconds */
  startSec: number;
  /** Segment end time in seconds */
  endSec: number;
  /** Original-language text */
  text: string;
  /** ISO 639-1 language code detected for this segment */
  lang: string;
  /** English translation if source was non-English; undefined for English source */
  textEn?: string;
  /** Speaker label from diarization, e.g. "SPEAKER_00" */
  speaker?: string;
  /** Optional confidence in [0, 1] */
  confidence?: number;
}

export interface TranscriptionResult {
  /** Provider that produced this result — for audit + debugging */
  provider: 'sarvam' | 'self_hosted';
  /** Full segment list ordered by startSec */
  segments: TranscriptionSegment[];
  /** Concatenated transcript in original language */
  fullText: string;
  /** Concatenated English translation */
  fullTextEn: string;
  /** Provider-detected dominant language (best-effort) */
  detectedLanguage?: string;
  /** Total audio duration in seconds */
  durationSec: number;
  /** Wall-clock processing duration in milliseconds */
  processingMs: number;
}

export interface TranscriptionInput {
  /** Pre-signed download URL OR direct path the provider can fetch */
  audioUrl: string;
  /** Hint to bias models; default 'auto' */
  languageHint?: TranscriptionLanguageHint;
  /** Whether to run speaker diarization. Default true for self_hosted. */
  diarize?: boolean;
  /** Domain biasing keywords (Faster-Whisper supports initial_prompt). */
  initialPrompt?: string;
}

export interface TranscriptionProvider {
  readonly name: 'sarvam' | 'self_hosted';
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

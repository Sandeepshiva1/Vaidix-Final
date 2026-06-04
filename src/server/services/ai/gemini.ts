// ════════════════════════════════════════════════════════════════════════════
// Gemini server helper — Phase A AI provider
// ════════════════════════════════════════════════════════════════════════════
// Thin wrapper over the Gemini REST API that the rest of the codebase calls.
// Phase B will swap with Vaidix Core via the same `AIProvider` interface;
// callers should depend on this module by name only.
//
// Two surfaces:
//   - geminiGenerate()      — text generation (and multimodal source ingestion)
//   - geminiGenerateImage() — image generation (Gemini 2.5 Flash Image / Nano
//                             Banana). Used by the AI router for the image
//                             pipeline (Gemini writes prompt → Gemini renders).

import { env } from '@/lib/env';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// User-safe messages — every `err.message` from this module is treated as
// client-visible (toasts, JSON error bodies). Upstream payloads, provider
// identity, status codes, and raw API JSON go into `.detail` for server logs
// ONLY. Never include `.detail` in API responses.
const AI_UNAVAILABLE_USER_MESSAGE =
  'The AI assistant is temporarily unavailable. Please try again in a moment.';
const AI_UNPARSEABLE_USER_MESSAGE =
  'The AI assistant returned an unexpected response. Please try again.';

export class GeminiUnavailableError extends Error {
  /** Upstream provider+status+body. Server-log only — never sent to clients. */
  public readonly detail: string;
  constructor(detail: string) {
    super(AI_UNAVAILABLE_USER_MESSAGE);
    this.name = 'GeminiUnavailableError';
    this.detail = detail;
  }
}
export class GeminiUnparseableError extends Error {
  public readonly detail: string;
  constructor(detail: string) {
    super(AI_UNPARSEABLE_USER_MESSAGE);
    this.name = 'GeminiUnparseableError';
    this.detail = detail;
  }
}

interface GenerateInput {
  systemInstruction: string;
  /** Either plain text or a list of parts (for vision: text + inline images). */
  userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  responseMimeType?: 'application/json' | 'text/plain';
  temperature?: number;
  /** Override env.GEMINI_MODEL when callers need a specific Gemini variant. */
  model?: string;
}

export async function geminiGenerate(input: GenerateInput): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new GeminiUnavailableError('GEMINI_API_KEY is not set');
  }
  const model = input.model ?? env.GEMINI_MODEL;
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: input.systemInstruction }] },
      contents: [{ role: 'user', parts: input.userParts }],
      generationConfig: {
        temperature: input.temperature ?? 0.2,
        responseMimeType: input.responseMimeType ?? 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GeminiUnavailableError(`Gemini ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new GeminiUnparseableError('Empty Gemini response');
  return text;
}

export interface GeminiImageInput {
  /** The image prompt. Should be a detailed clinical-illustration description. */
  prompt: string;
  /** Override env.GEMINI_IMAGE_MODEL when callers need a different renderer. */
  model?: string;
  /** Optional aspect ratio hint embedded into the prompt. */
  aspectRatio?: '1:1' | '4:3' | '16:9' | '9:16';
}

export interface GeminiImageOutput {
  /** Base64-encoded image bytes (no data: prefix). */
  data: string;
  /** MIME type returned by the model — typically 'image/png' or 'image/jpeg'. */
  mimeType: string;
  /** The model id that produced the image (echoed for logging/audit). */
  model: string;
}

/**
 * Generate a clinical-illustration image via Gemini 2.5 Flash Image (Nano
 * Banana). Returns base64 data + mime so callers can persist to S3 or stream
 * back to the browser as a data URL.
 */
export async function geminiGenerateImage(input: GeminiImageInput): Promise<GeminiImageOutput> {
  if (!env.GEMINI_API_KEY) {
    throw new GeminiUnavailableError('GEMINI_API_KEY is not set');
  }
  const model = input.model ?? env.GEMINI_IMAGE_MODEL;
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const promptText = input.aspectRatio
    ? `${input.prompt}\n\nAspect ratio: ${input.aspectRatio}.`
    : input.prompt;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GeminiUnavailableError(`Gemini image ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
      };
    }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new GeminiUnparseableError('No image bytes returned by Gemini');
  }
  return {
    data: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType ?? 'image/png',
    model,
  };
}

export function tryParseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1].trim()) as T;
      } catch {
        /* fall through */
      }
    }
    throw new GeminiUnparseableError(`Could not parse JSON from Gemini output: ${text.slice(0, 200)}`);
  }
}

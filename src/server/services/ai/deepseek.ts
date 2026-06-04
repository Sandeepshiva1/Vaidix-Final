// ════════════════════════════════════════════════════════════════════════════
// DeepSeek server helper — Opus/Sonnet stand-in
// ════════════════════════════════════════════════════════════════════════════
// Thin wrapper over the DeepSeek REST API (OpenAI-compatible chat completions).
// Used by the AI router (`./router.ts`) as the second-tier fallback when
// Anthropic Opus/Sonnet isn't reachable (no key, no credit, or upstream
// outage). DeepSeek-V3 ("deepseek-chat") gives near-Opus reasoning depth at
// a fraction of the cost; DeepSeek-R1 ("deepseek-reasoner") trades latency
// for harder reasoning when needed.
//
// Provider order maintained by the router:
//   1. Anthropic Opus/Sonnet  — if key set AND not out of credit
//   2. DeepSeek               — if DEEPSEEK_API_KEY set
//   3. Gemini Flash           — last resort, free tier

import { env } from '@/lib/env';

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1/chat/completions';

// User-safe messages — every `err.message` from this module is treated as
// client-visible. Upstream identity and rich payloads go into `.detail` for
// server logs ONLY. Never include `.detail` in API responses.
const AI_UNAVAILABLE_USER_MESSAGE =
  'The AI assistant is temporarily unavailable. Please try again in a moment.';
const AI_UNPARSEABLE_USER_MESSAGE =
  'The AI assistant returned an unexpected response. Please try again.';

export class DeepseekUnavailableError extends Error {
  public readonly detail: string;
  constructor(detail: string) {
    super(AI_UNAVAILABLE_USER_MESSAGE);
    this.name = 'DeepseekUnavailableError';
    this.detail = detail;
  }
}
export class DeepseekUnparseableError extends Error {
  public readonly detail: string;
  constructor(detail: string) {
    super(AI_UNPARSEABLE_USER_MESSAGE);
    this.name = 'DeepseekUnparseableError';
    this.detail = detail;
  }
}

interface GenerateInput {
  systemInstruction: string;
  userMessage: string;
  /** Override env.DEEPSEEK_MODEL when callers need 'deepseek-reasoner' for harder reasoning. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Hint that the response should be JSON. Adds the json_object response_format flag. */
  jsonOutput?: boolean;
}

export async function deepseekGenerate(input: GenerateInput): Promise<string> {
  if (!env.DEEPSEEK_API_KEY) {
    throw new DeepseekUnavailableError('DEEPSEEK_API_KEY is not set');
  }
  const model = input.model ?? env.DEEPSEEK_MODEL;
  const res = await fetch(DEEPSEEK_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: input.systemInstruction },
        { role: 'user', content: input.userMessage },
      ],
      temperature: input.temperature ?? 0.3,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.jsonOutput ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new DeepseekUnavailableError(`DeepSeek ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new DeepseekUnparseableError('Empty DeepSeek response');
  return text;
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
    throw new DeepseekUnparseableError(
      `Could not parse JSON from DeepSeek output: ${text.slice(0, 200)}`,
    );
  }
}

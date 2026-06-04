// ════════════════════════════════════════════════════════════════════════════
// Claude server helper — multi-model (Opus + Sonnet) routing
// ════════════════════════════════════════════════════════════════════════════
// Thin wrapper over the Anthropic SDK. Callers pass `model` per call so the
// AI router (`./router.ts`) can route reasoning-heavy ops to Opus and
// structure/design ops to Sonnet without callers knowing the model IDs.
//
// Existing callers (post-session content, etc.) that don't pass `model` get
// `env.ANTHROPIC_MODEL` (Sonnet by default) — backwards compatible.

import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

// User-safe messages — every `err.message` from this module is treated as
// client-visible. Upstream identity and rich payloads go into `.detail` for
// server logs ONLY. Never include `.detail` in API responses.
const AI_UNAVAILABLE_USER_MESSAGE =
  'The AI assistant is temporarily unavailable. Please try again in a moment.';
const AI_UNPARSEABLE_USER_MESSAGE =
  'The AI assistant returned an unexpected response. Please try again.';

export class ClaudeUnavailableError extends Error {
  public readonly detail: string;
  constructor(detail: string) {
    super(AI_UNAVAILABLE_USER_MESSAGE);
    this.name = 'ClaudeUnavailableError';
    this.detail = detail;
  }
}
export class ClaudeUnparseableError extends Error {
  public readonly detail: string;
  constructor(detail: string) {
    super(AI_UNPARSEABLE_USER_MESSAGE);
    this.name = 'ClaudeUnparseableError';
    this.detail = detail;
  }
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new ClaudeUnavailableError('ANTHROPIC_API_KEY is not set');
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

interface GenerateInput {
  systemInstruction: string;
  userMessage: string;
  /** Specific Anthropic model id. Defaults to env.ANTHROPIC_MODEL. Use the router instead of hardcoding here. */
  model?: string;
  /**
   * Caller-provided temperature is accepted for backwards compatibility but
   * NOT forwarded to the Anthropic SDK. Newer reasoning models (Opus 4.7+)
   * have deprecated the `temperature` parameter and return 400
   * `invalid_request_error` when it is sent. The model-side default produces
   * the same output quality for our system-prompt-constrained ops.
   */
  temperature?: number;
  maxTokens?: number;
}

export async function claudeGenerate(input: GenerateInput): Promise<string> {
  const client = getClient();
  let msg: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    msg = await client.messages.create({
      model: input.model ?? env.ANTHROPIC_MODEL,
      max_tokens: input.maxTokens ?? 4096,
      system: input.systemInstruction,
      messages: [{ role: 'user', content: input.userMessage }],
    });
  } catch (err) {
    // Anthropic SDK errors carry rich diagnostic JSON in `.message`. Keep that
    // payload on `.detail` (server-log only) and surface the safe generic
    // message to the wire. Billing errors are preserved verbatim on `.detail`
    // so router.ts can still detect them via isAnthropicBillingError.
    const detail = err instanceof Error ? err.message : String(err);
    throw new ClaudeUnavailableError(detail);
  }
  const block = msg.content[0];
  const text = block && block.type === 'text' ? block.text : '';
  if (!text) throw new ClaudeUnparseableError('Empty Claude response');
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
    throw new ClaudeUnparseableError(`Could not parse JSON from Claude output: ${text.slice(0, 200)}`);
  }
}

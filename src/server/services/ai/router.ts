// ════════════════════════════════════════════════════════════════════════════
// AI Router — single import surface for all feature-level AI work
// ════════════════════════════════════════════════════════════════════════════
// Routes per-operation across Opus / Sonnet / Gemini per the Vaidix routing
// decision (see memory: project_vaidix_ai_routing.md).
//
// Mental model:
//   - Opus    = "senior consultant"   — reasoning depth (review, content)
//   - Sonnet  = "curriculum designer" — structure/layout decisions (design)
//   - Gemini  = "fast assistant"      — polish, image prompts, image render,
//                                       multimodal source ingestion
//
// Honesty filter (ALWAYS apply when adding a new op): is this genuinely
// reasoning, or is it structured output / description / polish? If it's
// description, route to Sonnet or Gemini. Reserve Opus for ops where the
// depth visibly matters.
//
// Feature code MUST import from this module. Direct calls to claudeGenerate
// or geminiGenerate from feature code bypass the routing policy and break
// the abstraction Phase B (Vaidix Core SLM swap) depends on.

import { env } from '@/lib/env';
import {
  claudeGenerate,
  ClaudeUnavailableError,
  ClaudeUnparseableError,
  tryParseJson as tryParseClaudeJson,
} from './claude';
import {
  geminiGenerate,
  geminiGenerateImage,
  GeminiUnavailableError,
  GeminiUnparseableError,
  tryParseJson as tryParseGeminiJson,
  type GeminiImageOutput,
} from './gemini';
import {
  deepseekGenerate,
  DeepseekUnavailableError,
  DeepseekUnparseableError,
} from './deepseek';

// ─── Errors ────────────────────────────────────────────────────────────────
//
// Every `err.message` on these classes is treated as **client-visible**: it
// flows through `jsonError(code, err.message, status)` and into faculty
// toasts. So we keep `.message` generic and put the provider identity +
// upstream payload into `.detail` (server-log only).
//
// HARDENING: never log `provider` or `detail` to the wire. If you need to
// surface diagnostic context to ops, log it via `console.error` on the
// server — it lands in CloudWatch, not in the browser.

const AI_UNAVAILABLE_USER_MESSAGE =
  'The AI assistant is temporarily unavailable. Please try again in a moment.';
const AI_UNPARSEABLE_USER_MESSAGE =
  'The AI assistant returned an unexpected response. Please try again.';

export class AiUnavailableError extends Error {
  /** Server-log only — must never appear in API responses or client toasts. */
  public readonly detail: string;
  constructor(
    public readonly provider: 'opus' | 'sonnet' | 'gemini' | 'gemini-image',
    detail: string,
  ) {
    super(AI_UNAVAILABLE_USER_MESSAGE);
    this.name = 'AiUnavailableError';
    this.detail = detail;
  }
}

export class AiUnparseableError extends Error {
  public readonly detail: string;
  constructor(
    public readonly provider: 'opus' | 'sonnet' | 'gemini' | 'gemini-image',
    detail: string,
  ) {
    super(AI_UNPARSEABLE_USER_MESSAGE);
    this.name = 'AiUnparseableError';
    this.detail = detail;
  }
}

// Pull the rich diagnostic detail off a provider-level error so we can forward
// it to the router-level wrapper without losing context for server logs.
function detailOf(err: unknown): string {
  if (err && typeof err === 'object' && 'detail' in err && typeof (err as { detail: unknown }).detail === 'string') {
    return (err as { detail: string }).detail;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function wrapGeminiError(provider: 'gemini' | 'gemini-image', err: unknown): never {
  if (err instanceof GeminiUnavailableError) throw new AiUnavailableError(provider, detailOf(err));
  if (err instanceof GeminiUnparseableError) throw new AiUnparseableError(provider, detailOf(err));
  throw err;
}

// ─── Provider fallback chain ───────────────────────────────────────────────
// Reasoning ops (aiReview, aiEnhanceContent, aiDesign) try providers in order:
//
//   1. Anthropic Opus/Sonnet  — preferred, best clinical-reasoning quality
//   2. DeepSeek V3            — cheaper second tier, near-Opus depth
//   3. Gemini Flash           — last resort, free / cheap
//
// The chain auto-skips a tier when the key is missing OR when the upstream
// returns a billing-side error (out of credit, quota exceeded). A faculty
// whose Anthropic credit runs out mid-day silently degrades to DeepSeek —
// no manual swap. When credit is restored on the next call, Opus comes back.

const FALLBACK_GEMINI_MODEL = 'gemini-2.5-flash';

const fallbackWarned: Record<string, boolean> = {};
function warnOnce(key: string, msg: string): void {
  if (fallbackWarned[key]) return;
  fallbackWarned[key] = true;
  console.warn(`[ai/router] ${msg}`);
}

function hasRealAnthropicKey(): boolean {
  const k = env.ANTHROPIC_API_KEY;
  if (!k) return false;
  if (k.includes('REPLACE_WITH_YOUR_KEY')) return false;
  return true;
}

function hasDeepseekKey(): boolean {
  const k = env.DEEPSEEK_API_KEY;
  return !!k && k.length > 10;
}

// Detect Anthropic billing/credit errors so we can fall through to DeepSeek
// without surfacing a 503 to the faculty user. `claude.ts` now wraps every
// SDK error in `ClaudeUnavailableError` with the raw payload on `.detail`,
// so we check `.detail` first and fall back to `.message` for safety.
function isAnthropicBillingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const detail = (err as { detail?: unknown }).detail;
  const haystack = (typeof detail === 'string' ? detail : '') + ' ' + err.message;
  return (
    haystack.includes('credit balance is too low') ||
    haystack.includes('credit balance too low') ||
    haystack.includes('insufficient_quota')
  );
}

function isDeepseekBillingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes('insufficient') ||
    m.includes('quota') ||
    m.includes('billing') ||
    m.includes('payment')
  );
}

interface ReasoningCallOpts {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  maxTokens: number;
  /** true for review/content depth (Opus tier); false for design (Sonnet tier). */
  isOpusTier: boolean;
  jsonOutput: boolean;
}

/**
 * Single fallback-aware call site for every reasoning op. The three public
 * functions (aiReview, aiEnhanceContent, aiDesign) just configure this.
 */
async function callReasoningProvider(opts: ReasoningCallOpts): Promise<string> {
  // ─── Tier 1: Anthropic ───────────────────────────────────────────────
  if (hasRealAnthropicKey()) {
    try {
      return await claudeGenerate({
        model: opts.isOpusTier ? env.ANTHROPIC_OPUS_MODEL : env.ANTHROPIC_SONNET_MODEL,
        systemInstruction: opts.systemPrompt,
        userMessage: opts.userMessage,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
    } catch (err) {
      if (isAnthropicBillingError(err)) {
        warnOnce(
          'anthropic-billing',
          'Anthropic out of credit — falling through to DeepSeek/Gemini. Top up at console.anthropic.com to restore Opus.',
        );
      } else if (err instanceof ClaudeUnavailableError) {
        warnOnce('anthropic-unavailable', `Anthropic unavailable: ${err.detail}. Falling through.`);
      } else {
        if (err instanceof ClaudeUnparseableError) {
          throw new AiUnparseableError('opus', err.detail);
        }
        throw err;
      }
    }
  }

  // ─── Tier 2: DeepSeek ────────────────────────────────────────────────
  if (hasDeepseekKey()) {
    try {
      return await deepseekGenerate({
        model: env.DEEPSEEK_MODEL,
        systemInstruction: opts.systemPrompt,
        userMessage: opts.userMessage,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        jsonOutput: opts.jsonOutput,
      });
    } catch (err) {
      if (isDeepseekBillingError(err)) {
        warnOnce(
          'deepseek-billing',
          'DeepSeek out of credit — falling through to Gemini. Top up at platform.deepseek.com.',
        );
      } else if (err instanceof DeepseekUnavailableError) {
        warnOnce('deepseek-unavailable', `DeepSeek unavailable: ${err.detail}. Falling through.`);
      } else {
        if (err instanceof DeepseekUnparseableError) {
          throw new AiUnparseableError('gemini', `deepseek: ${err.detail}`);
        }
        throw err;
      }
    }
  }

  // ─── Tier 3: Gemini (last resort) ────────────────────────────────────
  warnOnce(
    'gemini-fallback',
    'Using Gemini Flash as reasoning fallback. Quality degraded for clinical reasoning. Add ANTHROPIC_API_KEY or DEEPSEEK_API_KEY for production.',
  );
  try {
    return await geminiGenerate({
      model: FALLBACK_GEMINI_MODEL,
      systemInstruction: opts.systemPrompt,
      userParts: [{ text: opts.userMessage }],
      responseMimeType: opts.jsonOutput ? 'application/json' : 'text/plain',
      temperature: opts.temperature,
    });
  } catch (err) {
    wrapGeminiError('gemini', err);
  }
}

// ─── Common input shapes ───────────────────────────────────────────────────

export interface ReasoningInput {
  systemPrompt: string;
  userMessage: string;
  /** Set true when system prompt asks for JSON; the result is parsed before return. */
  jsonOutput?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface PolishInput {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
}

// ─── Operations ────────────────────────────────────────────────────────────

/**
 * REVIEW — clinical-accuracy audit of an AI-generated artifact (deck slides,
 * case dialogue, pearl). Opus reasoning earns its cost here: "is this
 * medically correct, what's missing, are the differentials complete".
 *
 * Auto-falls-through Opus → DeepSeek → Gemini Flash on missing key or
 * billing errors. See callReasoningProvider for the chain.
 */
export async function aiReview(input: ReasoningInput): Promise<string> {
  return callReasoningProvider({
    systemPrompt: input.systemPrompt,
    userMessage: input.userMessage,
    temperature: input.temperature ?? 0.2,
    maxTokens: input.maxTokens ?? 4096,
    isOpusTier: true,
    jsonOutput: !!input.jsonOutput,
  });
}

export async function aiReviewJson<T>(input: ReasoningInput): Promise<T> {
  const text = await aiReview({ ...input, jsonOutput: true });
  try {
    return tryParseClaudeJson<T>(text);
  } catch (err) {
    if (err instanceof ClaudeUnparseableError) throw new AiUnparseableError('opus', err.detail);
    throw err;
  }
}

/**
 * DESIGN — structural / layout / pedagogy-format suggestions. Sonnet is
 * sufficient for "split this slide", "rebalance text/image", "insert poll
 * here". Not reasoning-heavy.
 *
 * Auto-falls-through Sonnet → DeepSeek → Gemini Flash.
 */
export async function aiDesign(input: ReasoningInput): Promise<string> {
  return callReasoningProvider({
    systemPrompt: input.systemPrompt,
    userMessage: input.userMessage,
    temperature: input.temperature ?? 0.3,
    maxTokens: input.maxTokens ?? 3000,
    isOpusTier: false,
    jsonOutput: !!input.jsonOutput,
  });
}

export async function aiDesignJson<T>(input: ReasoningInput): Promise<T> {
  const text = await aiDesign({ ...input, jsonOutput: true });
  try {
    return tryParseClaudeJson<T>(text);
  } catch (err) {
    if (err instanceof ClaudeUnparseableError) throw new AiUnparseableError('sonnet', err.detail);
    throw err;
  }
}

/**
 * ENHANCE ENGLISH — pure polish: tighten phrasing, fix grammar, crisper
 * bullets. Cheapest model wins because it's a description task.
 */
export async function aiEnhanceEnglish(input: PolishInput): Promise<string> {
  try {
    return await geminiGenerate({
      systemInstruction: input.systemPrompt,
      userParts: [{ text: input.userMessage }],
      responseMimeType: 'text/plain',
      temperature: input.temperature ?? 0.2,
    });
  } catch (err) {
    wrapGeminiError('gemini', err);
  }
}

/**
 * ENHANCE CONTENT — deepen reasoning, add evidence, surface edge cases,
 * "what would a senior consultant flag here". Opus earns its cost.
 *
 * Auto-falls-through Opus → DeepSeek → Gemini Flash on missing key or
 * billing errors.
 */
export async function aiEnhanceContent(input: ReasoningInput): Promise<string> {
  return callReasoningProvider({
    systemPrompt: input.systemPrompt,
    userMessage: input.userMessage,
    temperature: input.temperature ?? 0.4,
    maxTokens: input.maxTokens ?? 4096,
    isOpusTier: true,
    jsonOutput: !!input.jsonOutput,
  });
}

export async function aiEnhanceContentJson<T>(input: ReasoningInput): Promise<T> {
  const text = await aiEnhanceContent({ ...input, jsonOutput: true });
  try {
    return tryParseClaudeJson<T>(text);
  } catch (err) {
    if (err instanceof ClaudeUnparseableError) throw new AiUnparseableError('opus', err.detail);
    throw err;
  }
}

// ─── Source extraction (Gemini multimodal) ────────────────────────────────

export interface ExtractSourcePart {
  /** Plain text segment OR binary blob to send inline (PDF / image / etc.). */
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface ExtractSourceInput {
  systemPrompt: string;
  parts: ExtractSourcePart[];
  /** Defaults to 'application/json' when caller asks for structured output. */
  responseMimeType?: 'application/json' | 'text/plain';
  temperature?: number;
}

/**
 * EXTRACT FROM SOURCE — Gemini multimodal reads uploaded source material
 * (PDF, PPT-via-blob, transcript text) and produces an extraction. Used as
 * the first step of the wizard forge pipeline before Opus drafts the deck.
 *
 * Gemini is correct here: cheap, multimodal, native idiom for "ingest these
 * files and pull out the teaching content". NOT a reasoning task.
 */
export async function aiExtractFromSource(input: ExtractSourceInput): Promise<string> {
  try {
    const userParts = input.parts.map((p) =>
      p.inlineData ? { inlineData: p.inlineData } : { text: p.text ?? '' },
    );
    return await geminiGenerate({
      systemInstruction: input.systemPrompt,
      userParts,
      responseMimeType: input.responseMimeType ?? 'application/json',
      temperature: input.temperature ?? 0.2,
    });
  } catch (err) {
    wrapGeminiError('gemini', err);
  }
}

export async function aiExtractFromSourceJson<T>(input: ExtractSourceInput): Promise<T> {
  const text = await aiExtractFromSource({ ...input, responseMimeType: 'application/json' });
  try {
    return tryParseGeminiJson<T>(text);
  } catch (err) {
    if (err instanceof GeminiUnparseableError) throw new AiUnparseableError('gemini', err.detail);
    throw err;
  }
}

// ─── Image pipeline (single-vendor: Gemini writes, Gemini renders) ─────────
//
// System prompt lives at src/server/prompts/_base/op-deck-image-prompt.md.
// Imported lazily inside aiGenerateImagePrompt so this module stays
// import-cycle-free with the loader.

export interface ImagePromptInput {
  /** Slide / case title — what the image is about. */
  title: string;
  /** Optional bullets that describe what the image needs to show. */
  bullets?: string[];
  /**
   * Optional rich brief Opus wrote per slide describing the exact visual
   * (e.g. "Coronal cross-section of trabecular meshwork showing Schlemm's
   * canal closed by peripheral anterior synechiae"). When set, the image-
   * prompt writer leans on this over bullets — dynamic per-slide context
   * the deck author already authored. Wins over generic bullet inference.
   */
  imageBrief?: string;
  /** Optional caller hint, e.g. "anatomy diagram" or "fundus photograph". */
  styleHint?: string;
  /**
   * Optional speaker-notes excerpt for the slide — gives the prompt writer
   * additional clinical context (what to look for first, comparison hints).
   */
  speakerNotes?: string;
}

/**
 * IMAGE PROMPT — write a precise medical-illustration prompt. Gemini Flash
 * is correct here (description task, same family as the renderer = native
 * idiom, ~50x cheaper than Opus). DO NOT route to Opus — image prompt is
 * not a reasoning task.
 */
export async function aiGenerateImagePrompt(input: ImagePromptInput): Promise<string> {
  const { loadPrompt } = await import('@/server/prompts/loader');
  const sysPrompt = await loadPrompt('op-deck-image-prompt');
  const userMessage =
    `Slide title: ${input.title}\n` +
    (input.imageBrief
      ? `Image brief (authored per-slide by Opus):\n${input.imageBrief}\n`
      : '') +
    (input.bullets?.length
      ? `Bullets:\n${input.bullets.map((b) => `- ${b}`).join('\n')}\n`
      : '') +
    (input.speakerNotes
      ? `Speaker notes excerpt:\n${input.speakerNotes.slice(0, 400)}\n`
      : '') +
    (input.styleHint ? `Style hint: ${input.styleHint}\n` : '') +
    `\nWrite the image prompt now.`;
  try {
    const text = await geminiGenerate({
      systemInstruction: sysPrompt.text,
      userParts: [{ text: userMessage }],
      responseMimeType: 'text/plain',
      temperature: 0.4,
    });
    return text.trim().replace(/^["']|["']$/g, '').slice(0, 700);
  } catch (err) {
    wrapGeminiError('gemini', err);
  }
}

export interface ImageRenderInput {
  prompt: string;
  aspectRatio?: '1:1' | '4:3' | '16:9' | '9:16';
}

/**
 * IMAGE RENDER — Gemini Image (Nano Banana / Imagen). Returns base64 + mime
 * so callers can persist to S3 or stream as a data URL.
 */
export async function aiGenerateImage(input: ImageRenderInput): Promise<GeminiImageOutput> {
  try {
    return await geminiGenerateImage({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio ?? '16:9',
    });
  } catch (err) {
    wrapGeminiError('gemini-image', err);
  }
}

/**
 * Convenience: full image pipeline in one call. Writes the prompt, renders
 * the image, returns both for audit.
 */
export async function aiGenerateImageForSlide(input: ImagePromptInput & {
  aspectRatio?: '1:1' | '4:3' | '16:9' | '9:16';
}): Promise<{ prompt: string; image: GeminiImageOutput }> {
  const prompt = await aiGenerateImagePrompt(input);
  const image = await aiGenerateImage({ prompt, aspectRatio: input.aspectRatio });
  return { prompt, image };
}

// ─── Re-exports for convenience ────────────────────────────────────────────

export { tryParseClaudeJson, tryParseGeminiJson };
export type { GeminiImageOutput };

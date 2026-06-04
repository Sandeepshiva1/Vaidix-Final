// ════════════════════════════════════════════════════════════════════════════
// Deck Refine Service — per-slide AI rewrites (accept-suggestion + chat)
// ════════════════════════════════════════════════════════════════════════════
// Two callers:
//
//   1) AI Coach "Apply" button — `applySuggestionToSlide()`. The accepted
//      DeckSuggestion's proposedAction (or message) becomes the rewrite
//      instruction. Picks Opus or Gemini based on suggestion kind.
//
//   2) Per-slide chat input — `refineSlideWithInstruction()`. Faculty types
//      "tighten this", "add a clinical case vignette", "make 3 bullets". The
//      caller flags `intent: 'english' | 'content'` to pick the model:
//        - english → Gemini Flash (cheap polish)
//        - content → Opus 4.7   (deeper reasoning)
//
// Both return a *proposed* rewrite — they do NOT mutate the slide. The UI
// shows a diff; the user clicks Accept which calls PATCH /slides/[slideId]
// with the proposed body. This preserves faculty veto.

import { db } from '@/lib/db';
import {
  aiEnhanceContent,
  aiEnhanceEnglish,
  aiDesignJson,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';
import type { Slide, SlideLayout } from '@prisma/client';
import {
  type DeckSuggestion,
  type SuggestionKind,
} from './deck-analyze-service';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RefinedSlide {
  /** Proposed new title (<= 200 chars). */
  title: string;
  /** Proposed new bullets (<= 6 items, each <= 200 chars). */
  bullets: string[];
  /** Proposed new speaker notes (<= 1000 chars). null clears notes. */
  speakerNotes: string | null;
  /** Optional layout change. */
  layout?: SlideLayout;
}

export interface RefineProposal {
  slideId: string;
  before: RefinedSlide;
  after: RefinedSlide;
  /** Short human-readable description of what changed. */
  rationale: string;
  /**
   * Provider-neutral label that travels over the wire. We deliberately do
   * NOT expose the internal model identity (Opus / Sonnet / Gemini) here —
   * the choice is an implementation detail. Ops can find the actual tier
   * in server logs and the AI router fallback warnings.
   */
  source: 'ai';
}

export class DeckRefineError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// ─── Prompts ───────────────────────────────────────────────────────────────

const SLIDE_REWRITE_SYSTEM = `You are an ophthalmology medical-education slide editor at LV Prasad Eye Institute. You rewrite a single slide based on a faculty instruction.

TOPIC GUARD (read this first)
This editor is ONLY for editing ophthalmology / medical-education slide content. If the instruction is OFF-TOPIC — programming/coding tasks, general knowledge questions, math problems, personal tasks, news, jokes, finance, weather, anything unrelated to a medical teaching slide — DO NOT rewrite the slide. Instead output strict JSON:

  { "refused": true, "reason": "<one short polite sentence>" }

ON-TOPIC instructions (allow these): tighten / shorten / expand / add evidence / cite a guideline / fix grammar / rewrite for PG-1 / explain mechanism / clarify dosage / make it more interactive / add a pearl / strengthen the case relevance / translate for an Indian/LVPEI patient population / make it match latest AAO PPP. Any instruction whose subject is the SLIDE'S CLINICAL OR PEDAGOGICAL CONTENT is on-topic.

When ON-TOPIC, output strict JSON ONLY (no preamble, no markdown fences):
{
  "title": string,            // <= 200 chars
  "bullets": string[],        // 0-6 items, each <= 200 chars, no trailing periods
  "speakerNotes": string,     // <= 1000 chars; the *why* the presenter says aloud
  "layout": "TITLE_ONLY" | "TITLE_BULLETS" | "TWO_COLUMN" | "IMAGE_FOCUS" | "QUOTE" | "INTERACTION" | "CLOSING",
  "rationale": string         // 1 sentence describing what you changed and why, <= 200 chars
}

RULES
- Preserve clinical accuracy. If the instruction asks for unsupported claims (dosages, classification cutoffs not in the slide), keep the existing fact.
- Bullets are crisp phrases, not full sentences. No trailing punctuation.
- Speaker notes carry the *why* — the reasoning a presenter says aloud. Bullets carry the *what*.
- If asked to "split" or "shrink", output the FIRST resulting slide only. The faculty will create siblings via the editor.
- If the instruction is ambiguous, default to a tighter, more focused slide.`;

// ─── Helpers ───────────────────────────────────────────────────────────────

interface RawRewrite {
  title?: unknown;
  bullets?: unknown;
  speakerNotes?: unknown;
  layout?: unknown;
  rationale?: unknown;
  /** Topic-guard signal — when true, the model declined to rewrite. */
  refused?: unknown;
  reason?: unknown;
}

const ALLOWED_LAYOUTS: SlideLayout[] = [
  'TITLE_ONLY',
  'TITLE_BULLETS',
  'TWO_COLUMN',
  'IMAGE_FOCUS',
  'QUOTE',
  'INTERACTION',
  'CLOSING',
];

function normalizeRewrite(raw: RawRewrite, fallback: RefinedSlide): RefinedSlide & { rationale: string } {
  // Topic-guard refusal — the model declined an off-topic instruction.
  // Surface as a typed error so the route can return a 422 with the reason.
  if (raw.refused === true) {
    const reason =
      typeof raw.reason === 'string' && raw.reason.trim().length > 0
        ? raw.reason.trim().slice(0, 240)
        : 'Refine is restricted to ophthalmology slide content.';
    throw new DeckRefineError('OFF_TOPIC', reason);
  }
  const title =
    typeof raw.title === 'string' && raw.title.trim().length > 0
      ? raw.title.trim().slice(0, 200)
      : fallback.title;
  const bullets = Array.isArray(raw.bullets)
    ? (raw.bullets as unknown[])
        .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
        .slice(0, 6)
        .map((b) => b.trim().replace(/[.;,]+$/, '').slice(0, 200))
    : fallback.bullets;
  const speakerNotes =
    typeof raw.speakerNotes === 'string'
      ? raw.speakerNotes.trim().slice(0, 1000) || null
      : fallback.speakerNotes;
  const layout = ALLOWED_LAYOUTS.includes(raw.layout as SlideLayout)
    ? (raw.layout as SlideLayout)
    : fallback.layout ?? 'TITLE_BULLETS';
  const rationale =
    typeof raw.rationale === 'string' && raw.rationale.trim().length > 0
      ? raw.rationale.trim().slice(0, 240)
      : 'Refined.';
  return { title, bullets, speakerNotes, layout, rationale };
}

function slideToRefined(s: Slide): RefinedSlide {
  return {
    title: s.title,
    bullets: s.bullets,
    speakerNotes: s.speakerNotes,
    layout: s.layout,
  };
}

function buildRewriteUserMessage(
  slide: RefinedSlide,
  deckTitle: string,
  instruction: string,
): string {
  return JSON.stringify({
    deckTitle,
    instruction,
    currentSlide: slide,
  });
}

async function runOpusRewrite(
  slide: RefinedSlide,
  deckTitle: string,
  instruction: string,
): Promise<RefinedSlide & { rationale: string; source: 'ai' }> {
  const text = await aiEnhanceContent({
    systemPrompt: SLIDE_REWRITE_SYSTEM,
    userMessage: buildRewriteUserMessage(slide, deckTitle, instruction),
    temperature: 0.35,
    maxTokens: 2000,
  });
  const parsed = safeParseJson(text) as RawRewrite;
  return { ...normalizeRewrite(parsed, slide), source: 'ai' };
}

async function runSonnetRewrite(
  slide: RefinedSlide,
  deckTitle: string,
  instruction: string,
): Promise<RefinedSlide & { rationale: string; source: 'ai' }> {
  // Sonnet via aiDesignJson (typed parser).
  const parsed = await aiDesignJson<RawRewrite>({
    systemPrompt: SLIDE_REWRITE_SYSTEM,
    userMessage: buildRewriteUserMessage(slide, deckTitle, instruction),
    temperature: 0.3,
    maxTokens: 2000,
  });
  return { ...normalizeRewrite(parsed, slide), source: 'ai' };
}

async function runGeminiRewrite(
  slide: RefinedSlide,
  deckTitle: string,
  instruction: string,
): Promise<RefinedSlide & { rationale: string; source: 'ai' }> {
  const text = await aiEnhanceEnglish({
    systemPrompt: SLIDE_REWRITE_SYSTEM,
    userMessage: buildRewriteUserMessage(slide, deckTitle, instruction),
    temperature: 0.25,
  });
  const parsed = safeParseJson(text) as RawRewrite;
  return { ...normalizeRewrite(parsed, slide), source: 'ai' };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1].trim());
      } catch {
        /* fall through */
      }
    }
    throw new DeckRefineError('UNPARSEABLE_AI_OUTPUT', 'Could not parse AI rewrite');
  }
}

// ─── Routing decisions ─────────────────────────────────────────────────────

/**
 * Pick the model for an apply-suggestion call based on the suggestion kind.
 * - CLINICAL_ACCURACY / MISSING_CONTENT / OUTDATED_GUIDELINE → Opus
 *   (the original review pass was Opus; rewriting needs the same depth)
 * - TEXT_OVERLOAD / READABILITY → Gemini Flash
 *   (pure polish — drop bullets, tighten phrasing)
 * - VISUAL_BALANCE / STRUCTURE / INTERACTION_POINT → Sonnet
 *   (layout/structure decision)
 */
function modelForKind(kind: SuggestionKind): 'opus' | 'sonnet' | 'gemini' {
  switch (kind) {
    case 'CLINICAL_ACCURACY':
    case 'MISSING_CONTENT':
    case 'OUTDATED_GUIDELINE':
      return 'opus';
    case 'TEXT_OVERLOAD':
    case 'READABILITY':
      return 'gemini';
    case 'VISUAL_BALANCE':
    case 'STRUCTURE':
    case 'INTERACTION_POINT':
      return 'sonnet';
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface ApplySuggestionInput {
  jobId: string;
  suggestion: DeckSuggestion;
}

export async function applySuggestionToSlide(
  input: ApplySuggestionInput,
): Promise<RefineProposal> {
  if (!input.suggestion.slideId) {
    throw new DeckRefineError(
      'NO_TARGET_SLIDE',
      'Deck-level suggestions cannot be auto-applied — needs faculty action',
    );
  }
  const [job, slide] = await Promise.all([
    db.deckForgeJob.findUnique({
      where: { id: input.jobId },
      select: { inputTitle: true },
    }),
    db.slide.findUnique({ where: { id: input.suggestion.slideId } }),
  ]);
  if (!job || !slide) throw new DeckRefineError('NOT_FOUND', 'Deck or slide missing');

  const before = slideToRefined(slide);
  const instruction =
    input.suggestion.proposedAction ??
    `Address this issue: ${input.suggestion.message}`;
  const model = modelForKind(input.suggestion.kind);

  let rewritten: RefinedSlide & { rationale: string; source: 'ai' };
  try {
    if (model === 'opus') {
      rewritten = await runOpusRewrite(before, job.inputTitle ?? 'Deck', instruction);
    } else if (model === 'sonnet') {
      rewritten = await runSonnetRewrite(before, job.inputTitle ?? 'Deck', instruction);
    } else {
      rewritten = await runGeminiRewrite(before, job.inputTitle ?? 'Deck', instruction);
    }
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      throw new DeckRefineError('AI_UNAVAILABLE', err.message);
    }
    if (err instanceof AiUnparseableError) {
      throw new DeckRefineError('AI_UNPARSEABLE', err.message);
    }
    throw err;
  }

  const { rationale, source, ...after } = rewritten;
  return {
    slideId: slide.id,
    before,
    after,
    rationale,
    source,
  };
}

export interface RefineSlideInput {
  jobId: string;
  slideId: string;
  instruction: string;
  /** "english" → Gemini Flash; "content" → Opus 4.7. */
  intent: 'english' | 'content';
}

export async function refineSlideWithInstruction(
  input: RefineSlideInput,
): Promise<RefineProposal> {
  if (!input.instruction.trim()) {
    throw new DeckRefineError('EMPTY_INSTRUCTION', 'Instruction is required');
  }
  const [job, slide] = await Promise.all([
    db.deckForgeJob.findUnique({
      where: { id: input.jobId },
      select: { inputTitle: true },
    }),
    db.slide.findUnique({ where: { id: input.slideId } }),
  ]);
  if (!job || !slide) throw new DeckRefineError('NOT_FOUND', 'Deck or slide missing');
  if (slide.deckForgeJobId !== input.jobId) {
    throw new DeckRefineError('SLIDE_NOT_IN_DECK', 'Slide does not belong to this deck');
  }

  const before = slideToRefined(slide);
  const deckTitle = job.inputTitle ?? 'Deck';

  let rewritten: RefinedSlide & { rationale: string; source: 'ai' };
  try {
    if (input.intent === 'content') {
      rewritten = await runOpusRewrite(before, deckTitle, input.instruction.trim().slice(0, 500));
    } else {
      rewritten = await runGeminiRewrite(
        before,
        deckTitle,
        input.instruction.trim().slice(0, 500),
      );
    }
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      throw new DeckRefineError('AI_UNAVAILABLE', err.message);
    }
    if (err instanceof AiUnparseableError) {
      throw new DeckRefineError('AI_UNPARSEABLE', err.message);
    }
    throw err;
  }

  const { rationale, source, ...after } = rewritten;
  return {
    slideId: slide.id,
    before,
    after,
    rationale,
    source,
  };
}

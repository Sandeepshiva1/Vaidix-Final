// ════════════════════════════════════════════════════════════════════════════
// Deck Analyze Service — slide-aware, two-pass (Opus review + Sonnet design)
// ════════════════════════════════════════════════════════════════════════════
// Runs after a forge completes (or on demand) and produces structured
// suggestions the AI Coach panel renders inside the deck editor. Two passes
// in parallel:
//
//   - REVIEW (Opus 4.7) — clinical accuracy. "Is this medically correct?
//     Hallucinations? Missing critical content? Wrong dosage? Stale guideline?"
//
//   - DESIGN (Sonnet 4.6) — structure / pedagogy. "Slide too dense? Wrong
//     layout? Missing interaction every 6-8 slides? Visual balance off?"
//
// English polish + chat-based slide refinement live in deck-refine-service.ts
// and route to Gemini Flash (cheap polish) or Opus (deep content) per the
// router's `aiEnhanceEnglish` / `aiEnhanceContent` ops.
//
// Persisted to DeckForgeJob.analysisResult as a versioned blob (`source:
// "router-v2"`) — the v1 heuristic shape stays parseable for old rows.

import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';
import {
  aiReviewJson,
  aiDesignJson,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';
import type { SlideLayout } from '@prisma/client';

// ─── Types ─────────────────────────────────────────────────────────────────

export type SuggestionPass = 'review' | 'design';
export type SuggestionSeverity = 'high' | 'med' | 'low';
export type SuggestionKind =
  | 'CLINICAL_ACCURACY'
  | 'MISSING_CONTENT'
  | 'OUTDATED_GUIDELINE'
  | 'TEXT_OVERLOAD'
  | 'INTERACTION_POINT'
  | 'VISUAL_BALANCE'
  | 'READABILITY'
  | 'STRUCTURE';

export interface DeckSuggestion {
  /** Stable cuid — used by accept/dismiss endpoints to address one suggestion. */
  id: string;
  /** FK to Slide.id. null when the suggestion applies to the whole deck. */
  slideId: string | null;
  pass: SuggestionPass;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  message: string;
  /** Optional concrete action ("Split into 2 slides") the apply-suggestion
   *  endpoint can use as the rewrite instruction. */
  proposedAction?: string;
  /** ISO timestamp when this suggestion was created. */
  createdAt: string;
  /** Set when faculty has dismissed this suggestion. UI hides dismissed unless
   *  user toggles "show dismissed". */
  dismissedAt?: string;
  /** Set when faculty applied the suggestion (slide rewritten). */
  appliedAt?: string;
}

export interface DeckAnalysisResult {
  /** Versioned shape so v1 (heuristic, slideIdx-based) can coexist. */
  source: 'router-v2';
  readabilityScore: number; // 0–10
  slideDensityScore: number; // 0–10 (10 = best, low density)
  visualBalanceScore: number; // 0–10
  notes: string;
  suggestions: DeckSuggestion[];
  ranAt: string; // ISO
  passes: { review: 'ok' | 'failed' | 'skipped'; design: 'ok' | 'failed' | 'skipped' };
}

// ─── Errors ────────────────────────────────────────────────────────────────

export class DeckAnalyzeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// ─── Prompts ───────────────────────────────────────────────────────────────

const REVIEW_SYSTEM = `You are a senior consultant ophthalmologist at LV Prasad Eye Institute auditing an AI-drafted teaching deck for clinical accuracy. The deck targets ophthalmology residents.

You MUST output strict JSON ONLY (no preamble, no markdown fences, no commentary):
{
  "readabilityScore": number,           // 0-10, "is this clinically clear and well-pitched"
  "issues": [
    {
      "slideId": string | null,         // exact Slide.id from the input, or null for deck-level
      "kind": "CLINICAL_ACCURACY" | "MISSING_CONTENT" | "OUTDATED_GUIDELINE",
      "severity": "high" | "med" | "low",
      "message": string,                 // <= 200 chars, plain medical English, NO hedging
      "proposedAction": string | null    // optional concrete rewrite instruction <= 140 chars
    }
  ],
  "notes": string                        // 1-2 sentence overall verdict, <= 300 chars
}

REVIEW PRIORITIES (in order)
1. CLINICAL_ACCURACY — wrong drug names, wrong dosages, swapped findings (e.g. AAC vs PAC), wrong classification cutoffs, wrong surgical step. SEVERITY=high if it would mislead a resident in clinic.
2. MISSING_CONTENT — a critical differential, red-flag symptom, or contraindication absent from a slide where it belongs. SEVERITY=high if it could cause harm to omit; med otherwise.
3. OUTDATED_GUIDELINE — content reflects pre-2020 practice when current AAO PPP / PPP / RCOphth guidance differs. SEVERITY=med default.

RULES
- ONLY flag genuine issues. An empty issues array is the correct answer for a clean deck.
- Cite the slideId of the offending slide, never the array index.
- Do NOT flag layout, density, font size, or interaction-point issues — those belong to the design pass.
- No more than 8 issues total. If more exist, return the most important 8.`;

const DESIGN_SYSTEM = `You are a presentation design coach for medical-education decks at LV Prasad Eye Institute. The deck targets a 60-minute live lecture for ophthalmology residents.

You MUST output strict JSON ONLY (no preamble, no markdown fences, no commentary):
{
  "slideDensityScore": number,           // 0-10, 10 = ideal density across deck
  "visualBalanceScore": number,          // 0-10, 10 = ideal mix of text/whitespace/imagery
  "issues": [
    {
      "slideId": string | null,         // exact Slide.id from input, or null for deck-level
      "kind": "TEXT_OVERLOAD" | "INTERACTION_POINT" | "VISUAL_BALANCE" | "READABILITY" | "STRUCTURE",
      "severity": "high" | "med" | "low",
      "message": string,                 // <= 200 chars, actionable
      "proposedAction": string | null    // optional concrete fix <= 140 chars
    }
  ],
  "notes": string                        // 1-2 sentence overall verdict <= 300 chars
}

DESIGN PRIORITIES
1. TEXT_OVERLOAD — bullets > 6, bullet length > 140 chars, walls of text. SEVERITY=high if a slide has both > 5 bullets AND avg bullet > 100 chars.
2. INTERACTION_POINT — gap of > 8 consecutive slides without an INTERACTION layout. Flag the slide AFTER which a poll/T-F/case-vignette belongs. Also flag when the deck has ZERO "HOOK:" markers in speakerNotes (no attention hooks planted).
3. VISUAL_BALANCE — IMAGE_FOCUS slides without a meaningful image caption (bullet[0] should explain the image), TWO_COLUMN slides where one column dominates. Also flag IMAGE_FOCUS speakerNotes that do NOT name "what to look for" first or are missing a "...pause 3s..." cue.
4. READABILITY — speaker notes empty or < 30 chars on a content slide; titles > 90 chars; bullets ending in trailing punctuation. Also flag patronizing/absolute language ("very simple", "everyone knows", "obvious") in any speakerNotes. Also flag the deck-level absence of voice-modulation marks (CAPS for emphasis, "/" for pauses, "..." for slow-down) across ALL speakerNotes — note as deck-level slideId=null.
5. STRUCTURE — missing TITLE_ONLY hero, missing CLOSING, missing "Common pitfalls" slide near the end. Also flag: (a) missing EMPOWERMENT PROMISE near slide 2 (a slide whose title begins "By the end you will…" with ≤3 verb-led bullets); (b) no identifiable CORE MESSAGE echoed across hero/mid-deck/CLOSING; (c) CLOSING bullet[0] is just "Thank you / Q&A" instead of an ACTIONABLE TAKE-HOME ("on Monday in clinic, do X"); (d) section boundaries lack a TRANSITION bullet ("From X → to Y"); (e) non-trivial slides missing a "TIME: ~Xm" budget tag so total session length can be checked.

RULES
- Be strict. Most decks should land 5-7 across the two scores; >8 only for genuinely excellent.
- Empty issues array is correct for a clean deck.
- Cite slideId, never array index.
- Do NOT flag clinical accuracy — that's the review pass.
- Cap at 10 issues total.`;

// ─── Input shaping ─────────────────────────────────────────────────────────

interface SlideForAnalysis {
  id: string;
  order: number;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string | null;
}

function packDeckForPrompt(deckTitle: string, slides: SlideForAnalysis[]): string {
  const slideJson = slides.map((s) => ({
    slideId: s.id,
    order: s.order,
    layout: s.layout,
    title: s.title,
    bullets: s.bullets,
    speakerNotes: s.speakerNotes ?? '',
  }));
  return JSON.stringify({ deckTitle, slideCount: slides.length, slides: slideJson });
}

// ─── Pass runners ──────────────────────────────────────────────────────────

interface RawIssue {
  slideId?: unknown;
  kind?: unknown;
  severity?: unknown;
  message?: unknown;
  proposedAction?: unknown;
}

interface RawReview {
  readabilityScore?: unknown;
  issues?: unknown;
  notes?: unknown;
}

interface RawDesign {
  slideDensityScore?: unknown;
  visualBalanceScore?: unknown;
  issues?: unknown;
  notes?: unknown;
}

function clamp(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : fallback;
}

const REVIEW_KINDS: SuggestionKind[] = ['CLINICAL_ACCURACY', 'MISSING_CONTENT', 'OUTDATED_GUIDELINE'];
const DESIGN_KINDS: SuggestionKind[] = [
  'TEXT_OVERLOAD',
  'INTERACTION_POINT',
  'VISUAL_BALANCE',
  'READABILITY',
  'STRUCTURE',
];

function normalizeIssues(
  raw: unknown,
  pass: SuggestionPass,
  validSlideIds: Set<string>,
  cap: number,
): DeckSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const allowedKinds = pass === 'review' ? REVIEW_KINDS : DESIGN_KINDS;
  const now = new Date().toISOString();
  return (raw as RawIssue[])
    .slice(0, cap)
    .map((iss): DeckSuggestion | null => {
      const slideId =
        typeof iss.slideId === 'string' && validSlideIds.has(iss.slideId) ? iss.slideId : null;
      const kind = allowedKinds.includes(iss.kind as SuggestionKind)
        ? (iss.kind as SuggestionKind)
        : null;
      if (!kind) return null;
      const severity: SuggestionSeverity =
        iss.severity === 'high' || iss.severity === 'med' || iss.severity === 'low'
          ? iss.severity
          : 'med';
      const message =
        typeof iss.message === 'string' && iss.message.trim().length > 0
          ? iss.message.trim().slice(0, 240)
          : null;
      if (!message) return null;
      const proposedAction =
        typeof iss.proposedAction === 'string' && iss.proposedAction.trim().length > 0
          ? iss.proposedAction.trim().slice(0, 200)
          : undefined;
      return {
        id: randomUUID(),
        slideId,
        pass,
        kind,
        severity,
        message,
        proposedAction,
        createdAt: now,
      };
    })
    .filter((x): x is DeckSuggestion => x !== null);
}

async function runReviewPass(
  deckTitle: string,
  slides: SlideForAnalysis[],
): Promise<{ readability: number; suggestions: DeckSuggestion[]; notes: string; status: 'ok' | 'failed' }> {
  const validIds = new Set(slides.map((s) => s.id));
  try {
    const parsed = await aiReviewJson<RawReview>({
      systemPrompt: REVIEW_SYSTEM,
      userMessage: packDeckForPrompt(deckTitle, slides),
      temperature: 0.15,
      maxTokens: 3000,
    });
    return {
      readability: clamp(parsed.readabilityScore, 6),
      suggestions: normalizeIssues(parsed.issues, 'review', validIds, 8),
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 400) : '',
      status: 'ok',
    };
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiUnparseableError) {
      // Pass the error object (not just `.message`, which is now a generic
      // user-safe string) so `.detail` shows up alongside in the server log.
      console.warn('[deck-analyze] review pass failed:', err);
      return { readability: 6, suggestions: [], notes: '', status: 'failed' };
    }
    throw err;
  }
}

async function runDesignPass(
  deckTitle: string,
  slides: SlideForAnalysis[],
): Promise<{ density: number; balance: number; suggestions: DeckSuggestion[]; notes: string; status: 'ok' | 'failed' }> {
  const validIds = new Set(slides.map((s) => s.id));
  try {
    const parsed = await aiDesignJson<RawDesign>({
      systemPrompt: DESIGN_SYSTEM,
      userMessage: packDeckForPrompt(deckTitle, slides),
      temperature: 0.2,
      maxTokens: 3000,
    });
    return {
      density: clamp(parsed.slideDensityScore, 6),
      balance: clamp(parsed.visualBalanceScore, 6),
      suggestions: normalizeIssues(parsed.issues, 'design', validIds, 10),
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 400) : '',
      status: 'ok',
    };
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiUnparseableError) {
      console.warn('[deck-analyze] design pass failed:', err);
      return { density: 6, balance: 6, suggestions: [], notes: '', status: 'failed' };
    }
    throw err;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface AnalyzeDeckInput {
  jobId: string;
  /** When true, dismissed/applied flags from a prior run on the same deck are
   *  forgotten (full re-analysis). When false (default), prior dismissed
   *  suggestions are kept dismissed if their kind+slideId+message still
   *  appear — prevents re-pestering faculty. */
  resetState?: boolean;
}

export async function analyzeDeck(input: AnalyzeDeckInput): Promise<DeckAnalysisResult> {
  const job = await db.deckForgeJob.findUnique({
    where: { id: input.jobId },
    select: { id: true, inputTitle: true, analysisResult: true },
  });
  if (!job) throw new DeckAnalyzeError('NOT_FOUND', `Deck ${input.jobId} not found`);

  const slides = await db.slide.findMany({
    where: { deckForgeJobId: input.jobId },
    orderBy: { order: 'asc' },
    select: { id: true, order: true, layout: true, title: true, bullets: true, speakerNotes: true },
  });
  if (slides.length === 0) {
    throw new DeckAnalyzeError('EMPTY_DECK', 'Deck has no slides to analyze');
  }

  const slidesForPrompt: SlideForAnalysis[] = slides.map((s) => ({
    id: s.id,
    order: s.order,
    layout: s.layout,
    title: s.title,
    bullets: s.bullets,
    speakerNotes: s.speakerNotes,
  }));

  // Run both passes in parallel — independent providers, independent cost.
  const [review, design] = await Promise.all([
    runReviewPass(job.inputTitle ?? 'Untitled deck', slidesForPrompt),
    runDesignPass(job.inputTitle ?? 'Untitled deck', slidesForPrompt),
  ]);

  let suggestions: DeckSuggestion[] = [...review.suggestions, ...design.suggestions];

  // Carry forward dismissed/applied state on matching suggestions so faculty
  // doesn't see the same dismissed nag re-appear on every re-analyze.
  if (!input.resetState) {
    const prev = parsePreviousState(job.analysisResult);
    if (prev) {
      suggestions = suggestions.map((s) => {
        const match = prev.find(
          (p) =>
            p.kind === s.kind &&
            p.slideId === s.slideId &&
            p.message === s.message &&
            (p.dismissedAt || p.appliedAt),
        );
        if (!match) return s;
        return {
          ...s,
          dismissedAt: match.dismissedAt,
          appliedAt: match.appliedAt,
        };
      });
    }
  }

  const result: DeckAnalysisResult = {
    source: 'router-v2',
    readabilityScore: review.readability,
    slideDensityScore: design.density,
    visualBalanceScore: design.balance,
    notes:
      [review.notes, design.notes].filter((n) => n).join(' • ').slice(0, 500) ||
      'Analysis complete.',
    suggestions,
    ranAt: new Date().toISOString(),
    passes: { review: review.status, design: design.status },
  };

  await db.deckForgeJob.update({
    where: { id: input.jobId },
    data: { analysisResult: result as unknown as object },
  });

  return result;
}

function parsePreviousState(prev: unknown): DeckSuggestion[] | null {
  if (!prev || typeof prev !== 'object') return null;
  const p = prev as { source?: unknown; suggestions?: unknown };
  if (p.source !== 'router-v2' || !Array.isArray(p.suggestions)) return null;
  return p.suggestions as DeckSuggestion[];
}

// ─── Suggestion mutators (called by accept/dismiss endpoints) ──────────────

export async function dismissSuggestion(
  jobId: string,
  suggestionId: string,
): Promise<DeckAnalysisResult> {
  return mutateSuggestion(jobId, suggestionId, (s) => ({
    ...s,
    dismissedAt: new Date().toISOString(),
  }));
}

export async function markSuggestionApplied(
  jobId: string,
  suggestionId: string,
): Promise<DeckAnalysisResult> {
  return mutateSuggestion(jobId, suggestionId, (s) => ({
    ...s,
    appliedAt: new Date().toISOString(),
  }));
}

async function mutateSuggestion(
  jobId: string,
  suggestionId: string,
  patch: (s: DeckSuggestion) => DeckSuggestion,
): Promise<DeckAnalysisResult> {
  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    select: { analysisResult: true },
  });
  if (!job) throw new DeckAnalyzeError('NOT_FOUND', `Deck ${jobId} not found`);
  const current = job.analysisResult as unknown as DeckAnalysisResult | null;
  if (!current || current.source !== 'router-v2') {
    throw new DeckAnalyzeError('NO_ANALYSIS', 'Run analyze before mutating suggestions');
  }
  const idx = current.suggestions.findIndex((s) => s.id === suggestionId);
  if (idx === -1) throw new DeckAnalyzeError('SUGGESTION_NOT_FOUND', suggestionId);
  const next: DeckAnalysisResult = {
    ...current,
    suggestions: current.suggestions.map((s, i) => (i === idx ? patch(s) : s)),
  };
  await db.deckForgeJob.update({
    where: { id: jobId },
    data: { analysisResult: next as unknown as object },
  });
  return next;
}

export function isRouterV2(result: unknown): result is DeckAnalysisResult {
  if (typeof result !== 'object' || result === null) return false;
  const r = result as {
    source?: unknown;
    readabilityScore?: unknown;
    passes?: unknown;
    suggestions?: unknown;
  };
  // Source tag must be router-v2 AND the shape must be complete. Partial
  // shapes (e.g. wizard's initial-suggestions JSON before the user has
  // clicked Analyze) return false so the legacy editor treats them as null.
  return (
    r.source === 'router-v2' &&
    typeof r.readabilityScore === 'number' &&
    typeof r.passes === 'object' &&
    r.passes !== null &&
    Array.isArray(r.suggestions)
  );
}

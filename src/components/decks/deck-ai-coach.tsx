'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckAiCoach — right-panel coaching surface inside the deck editor
// ════════════════════════════════════════════════════════════════════════════
// Three regions stacked vertically:
//
//   1. Score card        — readability / density / balance traffic-light scores
//                          + "Re-analyze" CTA (calls POST /api/decks/.../analyze)
//   2. Suggestion list   — review (Opus) + design (Sonnet) issues. Active
//                          slide's suggestions surface first; deck-level after.
//                          Each card has Apply / Dismiss / open-slide actions.
//   3. Refine chat       — instruction box + intent toggle (English vs Content);
//                          posts to /slides/[id]/refine, surfaces a diff modal.
//
// Visual language:
//   - Pass badges color-coded: review = violet (Opus), design = teal (Sonnet)
//   - Severity uses traffic-light: high=rose, med=amber, low=emerald
//   - framer-motion stagger on suggestion list, layout animation on dismiss

import { useCallback, useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Sparkles,
  AlertTriangle,
  Stethoscope,
  Layout as LayoutIcon,
  MessageSquare,
  Send,
  X,
  Check,
  RefreshCw,
  ChevronRight,
  AlertCircle,
  Languages,
  Brain,
} from 'lucide-react';
import { csrfHeaders } from '@/lib/csrf-client';
import {
  type DeckSuggestion,
  type DeckAnalysisResult,
} from '@/server/services/decks/deck-analyze-service';
import { DeckDiffModal, type DiffProposal } from './deck-diff-modal';

// ─── Public types ──────────────────────────────────────────────────────────

export interface SlideForCoach {
  id: string;
  order: number;
}

interface Props {
  jobId: string;
  /** Initial analysis (may be null if never run; coach auto-triggers analyze on mount). */
  initialAnalysis: DeckAnalysisResult | null;
  /** All slides, used to translate suggestion.slideId → slide order. */
  slides: SlideForCoach[];
  /** Currently focused slide in the editor. */
  activeSlideId: string | null;
  /** Called when a slide is targeted (suggestion click navigates to its slide). */
  onFocusSlide: (slideId: string) => void;
  /** Called after a proposal is committed so the editor refreshes its slide state. */
  onSlideCommitted: (slideId: string, patch: { title: string; bullets: string[]; speakerNotes: string | null; layout?: string }) => Promise<void>;
}

// ─── Display helpers ────────────────────────────────────────────────────────

const KIND_META: Record<DeckSuggestion['kind'], { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  CLINICAL_ACCURACY: { label: 'Clinical accuracy', Icon: Stethoscope },
  MISSING_CONTENT: { label: 'Missing content', Icon: AlertTriangle },
  OUTDATED_GUIDELINE: { label: 'Outdated guideline', Icon: RefreshCw },
  TEXT_OVERLOAD: { label: 'Text overload', Icon: AlertCircle },
  INTERACTION_POINT: { label: 'Interaction point', Icon: MessageSquare },
  VISUAL_BALANCE: { label: 'Visual balance', Icon: LayoutIcon },
  READABILITY: { label: 'Readability', Icon: Sparkles },
  STRUCTURE: { label: 'Structure', Icon: LayoutIcon },
};

function passTone(pass: DeckSuggestion['pass']): string {
  return pass === 'review'
    ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
    : 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300';
}

function severityTone(sev: DeckSuggestion['severity']): string {
  return sev === 'high'
    ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
    : sev === 'med'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
}

function scoreTone(s: number): string {
  if (s >= 8) return 'text-emerald-600 dark:text-emerald-400';
  if (s >= 5) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DeckAiCoach({
  jobId,
  initialAnalysis,
  slides,
  activeSlideId,
  onFocusSlide,
  onSlideCommitted,
}: Props) {
  const [analysis, setAnalysis] = useState<DeckAnalysisResult | null>(initialAnalysis);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Diff modal state
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffCommitting, setDiffCommitting] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffProposal, setDiffProposal] = useState<DiffProposal | null>(null);
  /** Suggestion id we are applying — used to commit the suggestion after PATCH. */
  const [applyingSuggestionId, setApplyingSuggestionId] = useState<string | null>(null);

  // Auto-analyze on mount when we have no analysis yet.
  useEffect(() => {
    if (!analysis && !analyzing) {
      void runAnalyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { analysis: DeckAnalysisResult };
        error?: { message: string };
      };
      if (!json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Analyze failed (${res.status})`);
      }
      setAnalysis(json.data.analysis);
    } catch (err) {
      setAnalyzeError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }, [jobId]);

  // ─── Suggestion mutations ────────────────────────────────────────────────

  const dismissSuggestion = useCallback(
    async (suggestionId: string) => {
      // Optimistic flag — if the call fails, we still drop the network result.
      setAnalysis((prev) =>
        prev
          ? {
              ...prev,
              suggestions: prev.suggestions.map((s) =>
                s.id === suggestionId ? { ...s, dismissedAt: new Date().toISOString() } : s,
              ),
            }
          : prev,
      );
      try {
        const res = await fetch(
          `/api/decks/${jobId}/suggestions/${suggestionId}/dismiss`,
          { method: 'POST', headers: csrfHeaders() },
        );
        if (!res.ok) throw new Error(`Dismiss failed (${res.status})`);
        const json = (await res.json()) as { ok: boolean; data?: { analysis: DeckAnalysisResult } };
        if (json.ok && json.data) setAnalysis(json.data.analysis);
      } catch {
        // Best-effort — network errors don't roll back the optimistic flag.
      }
    },
    [jobId],
  );

  const startApplySuggestion = useCallback(
    async (suggestion: DeckSuggestion) => {
      if (!suggestion.slideId) {
        setAnalyzeError('Deck-level suggestions need manual editing — open the slide.');
        return;
      }
      onFocusSlide(suggestion.slideId);
      setApplyingSuggestionId(suggestion.id);
      setDiffOpen(true);
      setDiffLoading(true);
      setDiffProposal(null);
      setDiffError(null);
      try {
        const res = await fetch(
          `/api/decks/${jobId}/suggestions/${suggestion.id}/apply`,
          { method: 'POST', headers: csrfHeaders() },
        );
        const json = (await res.json()) as {
          ok: boolean;
          data?: { proposal: DiffProposal };
          error?: { message: string };
        };
        if (!json.ok || !json.data) {
          throw new Error(json.error?.message ?? `Apply failed (${res.status})`);
        }
        setDiffProposal(json.data.proposal);
      } catch (err) {
        setDiffError((err as Error).message);
      } finally {
        setDiffLoading(false);
      }
    },
    [jobId, onFocusSlide],
  );

  // ─── Refine chat ─────────────────────────────────────────────────────────

  const [refineInstruction, setRefineInstruction] = useState('');
  const [refineIntent, setRefineIntent] = useState<'english' | 'content'>('english');

  const startRefine = useCallback(async () => {
    if (!activeSlideId || !refineInstruction.trim()) return;
    setApplyingSuggestionId(null);
    setDiffOpen(true);
    setDiffLoading(true);
    setDiffProposal(null);
    setDiffError(null);
    try {
      const res = await fetch(
        `/api/decks/${jobId}/slides/${activeSlideId}/refine`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({
            instruction: refineInstruction.trim(),
            intent: refineIntent,
          }),
        },
      );
      const json = (await res.json()) as {
        ok: boolean;
        data?: { proposal: DiffProposal };
        error?: { message: string };
      };
      if (!json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Refine failed (${res.status})`);
      }
      setDiffProposal(json.data.proposal);
    } catch (err) {
      setDiffError((err as Error).message);
    } finally {
      setDiffLoading(false);
    }
  }, [activeSlideId, refineInstruction, refineIntent, jobId]);

  // ─── Diff commit ─────────────────────────────────────────────────────────

  const acceptProposal = useCallback(async () => {
    if (!diffProposal) return;
    setDiffCommitting(true);
    setDiffError(null);
    try {
      // 1. PATCH the slide with the new content.
      await onSlideCommitted(diffProposal.slideId, {
        title: diffProposal.after.title,
        bullets: diffProposal.after.bullets,
        speakerNotes: diffProposal.after.speakerNotes,
        layout: diffProposal.after.layout,
      });
      // 2. If this came from a suggestion, mark it applied.
      if (applyingSuggestionId) {
        const res = await fetch(
          `/api/decks/${jobId}/suggestions/${applyingSuggestionId}/apply?commit=true`,
          { method: 'POST', headers: csrfHeaders() },
        );
        const json = (await res.json()) as {
          ok: boolean;
          data?: { analysis: DeckAnalysisResult };
        };
        if (json.ok && json.data) setAnalysis(json.data.analysis);
      }
      // 3. Reset chat input so subsequent refines start fresh.
      setRefineInstruction('');
      setDiffOpen(false);
      setDiffProposal(null);
      setApplyingSuggestionId(null);
    } catch (err) {
      setDiffError((err as Error).message);
    } finally {
      setDiffCommitting(false);
    }
  }, [diffProposal, applyingSuggestionId, jobId, onSlideCommitted]);

  const cancelProposal = useCallback(() => {
    setDiffOpen(false);
    setDiffProposal(null);
    setApplyingSuggestionId(null);
    setDiffError(null);
  }, []);

  // ─── Suggestion grouping ─────────────────────────────────────────────────

  const slideOrderById = useMemo(
    () => new Map(slides.map((s) => [s.id, s.order])),
    [slides],
  );

  const visibleSuggestions = useMemo(() => {
    if (!analysis) return [];
    const live = analysis.suggestions.filter((s) => !s.dismissedAt && !s.appliedAt);
    // Active slide first, then deck-level, then others by slide order.
    return live.sort((a, b) => {
      const aActive = a.slideId === activeSlideId ? 0 : 1;
      const bActive = b.slideId === activeSlideId ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aDeck = a.slideId === null ? 0 : 1;
      const bDeck = b.slideId === null ? 0 : 1;
      if (aDeck !== bDeck) return aDeck - bDeck;
      const aOrd = a.slideId ? slideOrderById.get(a.slideId) ?? 999 : 999;
      const bOrd = b.slideId ? slideOrderById.get(b.slideId) ?? 999 : 999;
      return aOrd - bOrd;
    });
  }, [analysis, activeSlideId, slideOrderById]);

  const dismissedCount = analysis
    ? analysis.suggestions.filter((s) => s.dismissedAt).length
    : 0;
  const appliedCount = analysis
    ? analysis.suggestions.filter((s) => s.appliedAt).length
    : 0;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col" data-testid="deck-ai-coach">
      {/* Score card */}
      <section className="border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            AI Analysis
          </h3>
          <button
            type="button"
            onClick={runAnalyze}
            disabled={analyzing}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium transition hover:bg-muted disabled:opacity-50"
            data-testid="coach-reanalyze"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Analyzing
              </>
            ) : analysis ? (
              <>
                <RefreshCw className="h-3 w-3" /> Re-run
              </>
            ) : (
              <>
                <Brain className="h-3 w-3" /> Analyze
              </>
            )}
          </button>
        </div>

        {analyzing && !analysis ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
            AI is reviewing the deck…
          </div>
        ) : analysis ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <ScoreTile label="Read" score={analysis.readabilityScore} />
              <ScoreTile label="Density" score={analysis.slideDensityScore} />
              <ScoreTile label="Balance" score={analysis.visualBalanceScore} />
            </div>
            {analysis.notes && (
              <p className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {analysis.notes}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
              {analysis.passes?.review === 'failed' && (
                <span className="text-rose-500">Review pass failed</span>
              )}
              {analysis.passes?.design === 'failed' && (
                <span className="text-rose-500">Design pass failed</span>
              )}
              {appliedCount > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ {appliedCount} applied
                </span>
              )}
              {dismissedCount > 0 && <span>{dismissedCount} dismissed</span>}
            </div>
          </>
        ) : analyzeError ? (
          <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{analyzeError}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No analysis yet — click Analyze.</p>
        )}
      </section>

      {/* Suggestions */}
      <section className="flex-1 overflow-y-auto p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Suggestions ({visibleSuggestions.length})
        </h3>

        {visibleSuggestions.length === 0 && analysis ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No live suggestions. Deck looks clean.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="coach-suggestions">
            <AnimatePresence initial={false}>
              {visibleSuggestions.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  isActiveSlide={s.slideId === activeSlideId}
                  slideOrder={s.slideId ? slideOrderById.get(s.slideId) : undefined}
                  onApply={() => startApplySuggestion(s)}
                  onDismiss={() => dismissSuggestion(s.id)}
                  onFocus={() => s.slideId && onFocusSlide(s.slideId)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {/* Refine chat */}
      {activeSlideId && (
        <section className="border-t border-border bg-card/30 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            Refine this slide
          </h3>

          <div className="mb-2 inline-flex rounded-lg border border-border bg-background p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setRefineIntent('english')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                refineIntent === 'english'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Languages className="h-3 w-3" /> English
            </button>
            <button
              type="button"
              onClick={() => setRefineIntent('content')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                refineIntent === 'content'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Brain className="h-3 w-3" /> Content
            </button>
            <span className="ml-2 self-center pr-2 text-[9px] text-muted-foreground">
              {refineIntent === 'english' ? 'Quick polish' : 'Deeper reasoning'}
            </span>
          </div>

          <div className="flex gap-1.5">
            <textarea
              value={refineInstruction}
              onChange={(e) => setRefineInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void startRefine();
                }
              }}
              placeholder={
                refineIntent === 'english'
                  ? 'e.g. "tighten these bullets" or "fix grammar"'
                  : 'e.g. "add evidence for PRP threshold" or "include AAO PPP cutoff"'
              }
              className="min-h-[60px] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs"
              data-testid="coach-refine-input"
            />
            <button
              type="button"
              onClick={startRefine}
              disabled={!refineInstruction.trim() || diffLoading}
              className="self-start rounded-lg bg-foreground p-2 text-background transition hover:opacity-90 disabled:opacity-50"
              aria-label="Send refine instruction"
              data-testid="coach-refine-send"
            >
              {diffLoading && !applyingSuggestionId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">⌘/Ctrl + Enter to send</p>
        </section>
      )}

      <DeckDiffModal
        open={diffOpen}
        proposal={diffProposal}
        loading={diffLoading}
        committing={diffCommitting}
        error={diffError}
        onAccept={acceptProposal}
        onCancel={cancelProposal}
      />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ScoreTile({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-bold ${scoreTone(score)}`}>
        {score.toFixed(1)}
        <span className="text-[10px] font-normal text-muted-foreground">/10</span>
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  isActiveSlide,
  slideOrder,
  onApply,
  onDismiss,
  onFocus,
}: {
  suggestion: DeckSuggestion;
  isActiveSlide: boolean;
  slideOrder?: number;
  onApply: () => void;
  onDismiss: () => void;
  onFocus: () => void;
}) {
  const meta = KIND_META[suggestion.kind];
  const KindIcon = meta.Icon;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18 }}
      className={`overflow-hidden rounded-lg border bg-card p-3 transition ${
        isActiveSlide
          ? 'border-foreground/40 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]'
          : 'border-border hover:border-foreground/20'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${passTone(suggestion.pass)}`}
        >
          {suggestion.pass === 'review' ? 'Review' : 'Design'}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${severityTone(suggestion.severity)}`}
        >
          {suggestion.severity}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <KindIcon className="h-3 w-3" /> {meta.label}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {suggestion.slideId
            ? slideOrder !== undefined
              ? `Slide ${slideOrder + 1}`
              : 'Slide'
            : 'Deck-level'}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-foreground">{suggestion.message}</p>

      {suggestion.proposedAction && (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground">
          → {suggestion.proposedAction}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-1.5">
        {suggestion.slideId && (
          <>
            <button
              type="button"
              onClick={onApply}
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background transition hover:opacity-90"
              data-testid={`coach-apply-${suggestion.id}`}
            >
              <Check className="h-2.5 w-2.5" /> Apply
            </button>
            {!isActiveSlide && (
              <button
                type="button"
                onClick={onFocus}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                Open <ChevronRight className="h-2.5 w-2.5" />
              </button>
            )}
          </>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          data-testid={`coach-dismiss-${suggestion.id}`}
        >
          <X className="h-2.5 w-2.5" /> Dismiss
        </button>
      </div>
    </motion.li>
  );
}

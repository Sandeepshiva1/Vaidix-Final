'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckFixesPanel — "Fixes" tab body of the deck editor right panel
// ════════════════════════════════════════════════════════════════════════════
// The live suggestion list (review = Opus, design = Sonnet). Each card can be
// Applied (opens the shared diff modal via onApply), Dismissed, or used to
// focus its slide. Extracted verbatim from the former single DeckAiCoach so no
// behaviour or data-testid changes — only its location (now a dedicated tab).

import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  AlertTriangle,
  Stethoscope,
  Layout as LayoutIcon,
  MessageSquare,
  X,
  Check,
  RefreshCw,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { useMemo } from 'react';
import type {
  DeckSuggestion,
  DeckAnalysisResult,
} from '@/server/services/decks/deck-analyze-service';
import type { SlideForCoach } from './deck-coach-shared';

const KIND_META: Record<
  DeckSuggestion['kind'],
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
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

interface Props {
  analysis: DeckAnalysisResult | null;
  slides: SlideForCoach[];
  activeSlideId: string | null;
  onApply: (suggestion: DeckSuggestion) => void;
  onDismiss: (suggestionId: string) => void;
  onFocusSlide: (slideId: string) => void;
}

export function DeckFixesPanel({
  analysis,
  slides,
  activeSlideId,
  onApply,
  onDismiss,
  onFocusSlide,
}: Props) {
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

  if (!analysis) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Sparkles className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          No fixes yet. Run <span className="font-medium text-foreground">Analysis</span> to surface
          clinical and design suggestions you can apply with one click.
        </p>
      </div>
    );
  }

  return (
    <section className="h-full overflow-y-auto p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Suggestions ({visibleSuggestions.length})
      </h3>

      {visibleSuggestions.length === 0 ? (
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
                onApply={() => onApply(s)}
                onDismiss={() => onDismiss(s.id)}
                onFocus={() => s.slideId && onFocusSlide(s.slideId)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
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

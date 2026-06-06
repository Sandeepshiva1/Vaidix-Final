'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckRightPanel — tabbed right panel of the deck editor
// ════════════════════════════════════════════════════════════════════════════
// Four tabs: Analysis · Fixes · AI Slides · Hooks. This container owns the
// analysis state and the SHARED diff modal (both Fixes-apply and Analysis-refine
// drive one modal), all lifted verbatim from the former single DeckAiCoach so no
// endpoint call or behaviour changes — only the layout. The two new tabs (AI
// Slides, Hooks) are self-contained child components wired to real endpoints.

import { useCallback, useMemo, useState } from 'react';
import { Sparkles, ListChecks, LayoutGrid, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { csrfHeaders } from '@/lib/csrf-client';
import {
  type DeckSuggestion,
  type DeckAnalysisResult,
} from '@/server/services/decks/deck-analyze-service';
import { DeckDiffModal, type DiffProposal } from './deck-diff-modal';
import { DeckAnalysisPanel } from './deck-analysis-panel';
import { DeckFixesPanel } from './deck-fixes-panel';
import { DeckAiSlidesPanel } from './deck-ai-slides-panel';
import { DeckHooksPanel } from './deck-hooks-panel';
import type { SlideForCoach } from './deck-coach-shared';
import type { SlideViewModel } from './slide-canvas';

type TabKey = 'analysis' | 'fixes' | 'ai-slides' | 'hooks';

interface Props {
  jobId: string;
  initialAnalysis: DeckAnalysisResult | null;
  slides: SlideForCoach[];
  activeSlideId: string | null;
  activeSlideOrder: number | null;
  /** Present (session-studio context) → Hooks tab is functional. */
  sessionId: string | null;
  onFocusSlide: (slideId: string) => void;
  onSlideCommitted: (
    slideId: string,
    patch: { title: string; bullets: string[]; speakerNotes: string | null; layout?: string },
  ) => Promise<void>;
  /** New AI-generated slides to insert into the editor's local state + rail. */
  onSlidesAppended: (slides: SlideViewModel[]) => void;
}

export function DeckRightPanel({
  jobId,
  initialAnalysis,
  slides,
  activeSlideId,
  activeSlideOrder,
  sessionId,
  onFocusSlide,
  onSlideCommitted,
  onSlidesAppended,
}: Props) {
  const [tab, setTab] = useState<TabKey>('analysis');

  // ── Analysis state (lifted from DeckAiCoach) ──────────────────────────────
  const [analysis, setAnalysis] = useState<DeckAnalysisResult | null>(initialAnalysis);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // ── Shared diff modal state (Fixes-apply + Analysis-refine) ───────────────
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffCommitting, setDiffCommitting] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffProposal, setDiffProposal] = useState<DiffProposal | null>(null);
  const [applyingSuggestionId, setApplyingSuggestionId] = useState<string | null>(null);

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

  const dismissSuggestion = useCallback(
    async (suggestionId: string) => {
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
        const res = await fetch(`/api/decks/${jobId}/suggestions/${suggestionId}/dismiss`, {
          method: 'POST',
          headers: csrfHeaders(),
        });
        if (!res.ok) throw new Error(`Dismiss failed (${res.status})`);
        const json = (await res.json()) as { ok: boolean; data?: { analysis: DeckAnalysisResult } };
        if (json.ok && json.data) setAnalysis(json.data.analysis);
      } catch {
        // Best-effort — network errors don't roll back the optimistic flag.
      }
    },
    [jobId],
  );

  const applySuggestion = useCallback(
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
        const res = await fetch(`/api/decks/${jobId}/suggestions/${suggestion.id}/apply`, {
          method: 'POST',
          headers: csrfHeaders(),
        });
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

  const refine = useCallback(
    async (instruction: string, intent: 'english' | 'content') => {
      if (!activeSlideId || !instruction.trim()) return;
      setApplyingSuggestionId(null);
      setDiffOpen(true);
      setDiffLoading(true);
      setDiffProposal(null);
      setDiffError(null);
      try {
        const res = await fetch(`/api/decks/${jobId}/slides/${activeSlideId}/refine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ instruction: instruction.trim(), intent }),
        });
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
    },
    [activeSlideId, jobId],
  );

  const acceptProposal = useCallback(async () => {
    if (!diffProposal) return;
    setDiffCommitting(true);
    setDiffError(null);
    try {
      await onSlideCommitted(diffProposal.slideId, {
        title: diffProposal.after.title,
        bullets: diffProposal.after.bullets,
        speakerNotes: diffProposal.after.speakerNotes,
        layout: diffProposal.after.layout,
      });
      if (applyingSuggestionId) {
        const res = await fetch(
          `/api/decks/${jobId}/suggestions/${applyingSuggestionId}/apply?commit=true`,
          { method: 'POST', headers: csrfHeaders() },
        );
        const json = (await res.json()) as { ok: boolean; data?: { analysis: DeckAnalysisResult } };
        if (json.ok && json.data) setAnalysis(json.data.analysis);
      }
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

  const liveFixCount = useMemo(
    () => (analysis ? analysis.suggestions.filter((s) => !s.dismissedAt && !s.appliedAt).length : 0),
    [analysis],
  );

  const TABS: { key: TabKey; label: string; Icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { key: 'analysis', label: 'Analysis', Icon: Sparkles },
    { key: 'fixes', label: 'Fixes', Icon: ListChecks, badge: liveFixCount },
    { key: 'ai-slides', label: 'AI Slides', Icon: LayoutGrid },
    { key: 'hooks', label: 'Hooks', Icon: Zap },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border/60 px-2 pt-1.5">
        {TABS.map((t) => {
          const TIcon = t.Icon;
          const activeTab = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'relative inline-flex items-center gap-1.5 rounded-t-md px-2.5 py-2 text-[11px] font-medium transition-colors',
                activeTab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid={`deck-tab-${t.key}`}
            >
              <TIcon className="h-3.5 w-3.5" />
              {t.label}
              {t.badge ? (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                  {t.badge}
                </span>
              ) : null}
              {activeTab && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-linear-to-r from-teal-500 to-emerald-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'analysis' && (
          <DeckAnalysisPanel
            analysis={analysis}
            analyzing={analyzing}
            analyzeError={analyzeError}
            onAnalyze={runAnalyze}
            activeSlideId={activeSlideId}
            refining={diffLoading && !applyingSuggestionId}
            onRefine={refine}
          />
        )}
        {tab === 'fixes' && (
          <DeckFixesPanel
            analysis={analysis}
            slides={slides}
            activeSlideId={activeSlideId}
            onApply={applySuggestion}
            onDismiss={dismissSuggestion}
            onFocusSlide={onFocusSlide}
          />
        )}
        {tab === 'ai-slides' && (
          <DeckAiSlidesPanel jobId={jobId} onSlidesAppended={onSlidesAppended} />
        )}
        {tab === 'hooks' && (
          <DeckHooksPanel sessionId={sessionId} activeSlideOrder={activeSlideOrder} />
        )}
      </div>

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

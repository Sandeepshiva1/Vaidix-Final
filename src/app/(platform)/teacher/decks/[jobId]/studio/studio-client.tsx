'use client';

// ════════════════════════════════════════════════════════════════════════════
// Presentation Studio — Phase 1C
// ════════════════════════════════════════════════════════════════════════════
// 3-pane layout modelled on 4_1_1_presentation_studio.html:
//   • Left  (220px): SlideThumbList with per-slide issue badges
//   • Center        : SlideEditorCanvas (reuses SlideCanvas) + annotation pins
//   • Right (300px) : AiPanel — tabbed Analysis / Suggestions / Interactions
//                     + refine chat input footer
//
// State management:
//   - All cross-pane state lives in StudioClient
//   - Analyze is on-demand only (user clicks "Run analysis") — never auto-run,
//     since a pass costs Opus+Sonnet tokens; persisted results show for free
//   - Slide edits debounce-persist to PATCH /slides/[id]
//   - Suggestion apply opens DeckDiffModal (reused from legacy)
//   - Finalize → POST /api/decks/[jobId]/finalize (Phase 1C new endpoint)

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
  Check,
  X,
  AlertCircle,
  AlertTriangle,
  Stethoscope,
  MessageSquare,
  Layout as LayoutIcon,
  RefreshCw,
  Lock,
  Presentation,
  Download,
  Languages,
  Brain,
  Send,
  CheckCircle2,
  CircleDot,
  Eye,
} from 'lucide-react';
import { csrfHeaders } from '@/lib/csrf-client';
import { SlideCanvas, type SlideViewModel } from '@/components/decks/slide-canvas';
import { DeckDiffModal, type DiffProposal } from '@/components/decks/deck-diff-modal';
import { ThemePicker } from '@/components/decks/theme-picker';
import { BackgroundPicker } from '@/components/decks/background-picker';
import { getDeckTheme } from '@/lib/deck-themes';
import type {
  DeckAnalysisResult,
  DeckSuggestion,
} from '@/server/services/decks/deck-analyze-service';
import type { DeckForgeStatus } from '@prisma/client';

// ─── Public types ──────────────────────────────────────────────────────────

interface Props {
  jobId: string;
  deckTitle: string;
  status: DeckForgeStatus;
  sourceLabel: string;
  initialSlides: SlideViewModel[];
  initialAnalysis: DeckAnalysisResult | null;
  initialTheme?: string | null;
  /** Per-deck background colour override (hex, no '#'); null = theme default. */
  initialBackgroundHex?: string | null;
  /** How the deck was created (AI_GENERATED / VERBATIM / …). */
  initialImportMode?: string | null;
}

type RightTab = 'analysis' | 'suggestions' | 'interactions';
type RefineIntent = 'english' | 'content';

// ─── Display helpers ───────────────────────────────────────────────────────

const KIND_LABEL: Record<DeckSuggestion['kind'], string> = {
  CLINICAL_ACCURACY: 'Clinical accuracy',
  MISSING_CONTENT: 'Missing content',
  OUTDATED_GUIDELINE: 'Outdated guideline',
  TEXT_OVERLOAD: 'Text overload',
  INTERACTION_POINT: 'Interaction point',
  VISUAL_BALANCE: 'Visual balance',
  READABILITY: 'Readability',
  STRUCTURE: 'Structure',
};

const KIND_ICON: Record<DeckSuggestion['kind'], React.ComponentType<{ className?: string }>> = {
  CLINICAL_ACCURACY: Stethoscope,
  MISSING_CONTENT: AlertTriangle,
  OUTDATED_GUIDELINE: RefreshCw,
  TEXT_OVERLOAD: AlertCircle,
  INTERACTION_POINT: MessageSquare,
  VISUAL_BALANCE: LayoutIcon,
  READABILITY: Sparkles,
  STRUCTURE: LayoutIcon,
};

const SEVERITY_TONE: Record<DeckSuggestion['severity'], { ring: string; chip: string; text: string }> = {
  high: {
    ring: 'ring-rose-500/40',
    chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    text: 'text-rose-700 dark:text-rose-300',
  },
  med: {
    ring: 'ring-amber-500/40',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    text: 'text-amber-700 dark:text-amber-300',
  },
  low: {
    ring: 'ring-emerald-500/40',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
};

function scoreTone(s: number): string {
  if (s >= 8) return 'text-emerald-600 dark:text-emerald-400';
  if (s >= 5) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function scoreBg(s: number): string {
  if (s >= 8) return 'from-emerald-500/15 to-emerald-500/5';
  if (s >= 5) return 'from-amber-500/15 to-amber-500/5';
  return 'from-rose-500/15 to-rose-500/5';
}

function countActive(suggestions: DeckSuggestion[], slideId: string | null): number {
  return suggestions.filter(
    (s) => s.slideId === slideId && !s.dismissedAt && !s.appliedAt,
  ).length;
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function StudioClient({
  jobId,
  deckTitle,
  status,
  sourceLabel,
  initialSlides,
  initialAnalysis,
  initialTheme,
  initialBackgroundHex,
  initialImportMode,
}: Props) {
  const [slides, setSlides] = useState<SlideViewModel[]>(initialSlides);
  const [activeId, setActiveId] = useState<string | null>(initialSlides[0]?.id ?? null);
  const [themeId, setThemeId] = useState<string>(initialTheme ?? 'deep-space');
  const [backgroundHex, setBackgroundHex] = useState<string | null>(initialBackgroundHex ?? null);
  // VERBATIM decks default to the pixel-faithful "Original" view; toggleable to
  // the editable Vaidix canvas. Only shown when a slide has an original image.
  const [viewMode, setViewMode] = useState<'original' | 'editable'>(
    initialImportMode === 'VERBATIM' ? 'original' : 'editable',
  );
  const [analysis, setAnalysis] = useState<DeckAnalysisResult | null>(initialAnalysis);
  const [rightTab, setRightTab] = useState<RightTab>('analysis');
  const [currentStatus, setCurrentStatus] = useState<DeckForgeStatus>(status);

  // ─── Analyze: on-demand only (never auto-fired — costs Opus+Sonnet tokens) ─
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

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

  // Analysis is NOT auto-run on mount. A pass is Opus (review) + Sonnet
  // (design) over the whole deck and costs real tokens, so the faculty must
  // click "Analyze". Any persisted result arrives via `initialAnalysis` and
  // shows for free; running analyze persists it so revisits reuse it.

  // ─── Active slide derivation ─────────────────────────────────────────────
  const active = useMemo(
    () => slides.find((s) => s.id === activeId) ?? slides[0] ?? null,
    [slides, activeId],
  );

  const goPrev = useCallback(() => {
    if (!active) return;
    const idx = slides.findIndex((s) => s.id === active.id);
    if (idx > 0) setActiveId(slides[idx - 1].id);
  }, [active, slides]);
  const goNext = useCallback(() => {
    if (!active) return;
    const idx = slides.findIndex((s) => s.id === active.id);
    if (idx >= 0 && idx < slides.length - 1) setActiveId(slides[idx + 1].id);
  }, [active, slides]);

  // ─── Slide PATCH + autosave ──────────────────────────────────────────────
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Persist theme via PATCH /api/decks/[jobId] with { template }. Same route
  // the legacy editor uses — keeps the storage column shared so the picker
  // stays in sync whichever surface the faculty opens next. Errors surface
  // through the same saveError toast as slide-edit failures.
  const persistTheme = useCallback(
    async (id: string) => {
      setThemeId(id);
      setSaveError(null);
      try {
        const res = await fetch(`/api/decks/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ template: id }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(j?.error?.message ?? `Theme save failed (${res.status})`);
        }
      } catch (err) {
        setSaveError((err as Error).message);
      }
    },
    [jobId],
  );

  // Per-deck background override (hex, no '#') or null to reset to the theme.
  // Same PATCH route/column as the legacy editor so the two stay in sync.
  const persistBackground = useCallback(
    async (hex: string | null) => {
      setBackgroundHex(hex);
      setSaveError(null);
      try {
        const res = await fetch(`/api/decks/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ backgroundHex: hex }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(j?.error?.message ?? `Background save failed (${res.status})`);
        }
      } catch (err) {
        setSaveError((err as Error).message);
      }
    },
    [jobId],
  );

  const persistSlide = useCallback(
    async (id: string, patch: Partial<SlideViewModel>) => {
      setSavingId(id);
      setSaveError(null);
      try {
        const res = await fetch(`/api/decks/${jobId}/slides/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(j?.error?.message ?? `Save failed (${res.status})`);
        }
      } catch (err) {
        setSaveError((err as Error).message);
      } finally {
        setSavingId(null);
      }
    },
    [jobId],
  );

  const updateLocal = useCallback((id: string, patch: Partial<SlideViewModel>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  // ─── Suggestion actions ──────────────────────────────────────────────────
  const [diffProposal, setDiffProposal] = useState<DiffProposal | null>(null);
  /** The suggestion that owns the currently-open diff, if any. Used to mark
   *  appliedAt locally when the user accepts. Refine-chat opens a diff with
   *  no owning suggestion → this stays null. */
  const [diffSuggestionId, setDiffSuggestionId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [diffCommitting, setDiffCommitting] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const openApply = useCallback(
    async (sugg: DeckSuggestion) => {
      setApplyingId(sugg.id);
      setDiffError(null);
      try {
        const res = await fetch(
          `/api/decks/${jobId}/suggestions/${sugg.id}/apply`,
          { method: 'POST', headers: { ...csrfHeaders() } },
        );
        const json = (await res.json()) as {
          ok: boolean;
          data?: { proposal: DiffProposal };
          error?: { message: string };
        };
        if (!json.ok || !json.data) {
          throw new Error(json.error?.message ?? `Could not draft proposal (${res.status})`);
        }
        setDiffProposal(json.data.proposal);
        setDiffSuggestionId(sugg.id);
      } catch (err) {
        setSaveError((err as Error).message);
      } finally {
        setApplyingId(null);
      }
    },
    [jobId],
  );

  const closeDiff = useCallback(() => {
    setDiffProposal(null);
    setDiffSuggestionId(null);
    setDiffError(null);
  }, []);

  const commitDiff = useCallback(async () => {
    if (!diffProposal) return;
    setDiffCommitting(true);
    setDiffError(null);
    try {
      // Persist the rewrite via the slide PATCH.
      const res = await fetch(`/api/decks/${jobId}/slides/${diffProposal.slideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          title: diffProposal.after.title,
          bullets: diffProposal.after.bullets,
          speakerNotes: diffProposal.after.speakerNotes,
          ...(diffProposal.after.layout ? { layout: diffProposal.after.layout } : {}),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Commit failed (${res.status})`);
      }
      // Reflect locally.
      updateLocal(diffProposal.slideId, {
        title: diffProposal.after.title,
        bullets: diffProposal.after.bullets,
        speakerNotes: diffProposal.after.speakerNotes,
        ...(diffProposal.after.layout ? { layout: diffProposal.after.layout } : {}),
      });
      // Mark suggestion applied if this diff came from one.
      if (diffSuggestionId) {
        setAnalysis((prev) =>
          prev
            ? {
                ...prev,
                suggestions: prev.suggestions.map((s) =>
                  s.id === diffSuggestionId
                    ? { ...s, appliedAt: new Date().toISOString() }
                    : s,
                ),
              }
            : prev,
        );
      }
      closeDiff();
    } catch (err) {
      setDiffError((err as Error).message);
    } finally {
      setDiffCommitting(false);
    }
  }, [diffProposal, diffSuggestionId, jobId, updateLocal, closeDiff]);

  const dismiss = useCallback(
    async (sugg: DeckSuggestion) => {
      try {
        await fetch(`/api/decks/${jobId}/suggestions/${sugg.id}/dismiss`, {
          method: 'POST',
          headers: { ...csrfHeaders() },
        });
        // Local-only update — mark dismissed without refetch.
        setAnalysis((prev) =>
          prev
            ? {
                ...prev,
                suggestions: prev.suggestions.map((s) =>
                  s.id === sugg.id ? { ...s, dismissedAt: new Date().toISOString() } : s,
                ),
              }
            : prev,
        );
      } catch (err) {
        setSaveError((err as Error).message);
      }
    },
    [jobId],
  );

  // ─── Refine chat ─────────────────────────────────────────────────────────
  const [refineIntent, setRefineIntent] = useState<RefineIntent>('english');
  const [refineInput, setRefineInput] = useState('');
  const [refining, setRefining] = useState(false);

  const sendRefine = useCallback(async () => {
    if (!active || !refineInput.trim()) return;
    setRefining(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/slides/${active.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          instruction: refineInput.trim(),
          intent: refineIntent,
        }),
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
      setDiffSuggestionId(null); // refine has no owning suggestion
      setRefineInput('');
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setRefining(false);
    }
  }, [active, refineInput, refineIntent, jobId]);

  // ─── Finalize ────────────────────────────────────────────────────────────
  const [finalizing, setFinalizing] = useState(false);

  const onFinalize = useCallback(async () => {
    if (finalizing) return;
    setFinalizing(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/finalize`, {
        method: 'POST',
        headers: { ...csrfHeaders() },
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { status: DeckForgeStatus };
        error?: { message: string };
      };
      if (!json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Finalize failed (${res.status})`);
      }
      setCurrentStatus(json.data.status);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setFinalizing(false);
    }
  }, [finalizing, jobId]);

  // ─── Export pptx (reuses existing route) ─────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/decks/${jobId}/export-pptx`, {
        method: 'POST',
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deckTitle.replace(/\W+/g, '-')}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }, [jobId, deckTitle]);

  // ─── Derived data ────────────────────────────────────────────────────────
  const activeSuggestions = useMemo(
    () =>
      analysis?.suggestions.filter(
        (s) => s.slideId === active?.id && !s.dismissedAt && !s.appliedAt,
      ) ?? [],
    [analysis, active],
  );

  const totalActive = useMemo(
    () => analysis?.suggestions.filter((s) => !s.dismissedAt && !s.appliedAt).length ?? 0,
    [analysis],
  );

  const isFinalized = currentStatus === ('APPROVED' as DeckForgeStatus);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col bg-muted/30 text-foreground sm:-m-6"
      data-testid="studio"
    >
      {/* ─── Topbar ────────────────────────────────────────────────────── */}
      <Topbar
        deckTitle={deckTitle}
        sourceLabel={sourceLabel}
        status={currentStatus}
        savingId={savingId}
        onFinalize={onFinalize}
        finalizing={finalizing}
        isFinalized={isFinalized}
        themeId={themeId}
        onThemeChange={persistTheme}
        backgroundHex={backgroundHex}
        onBackgroundChange={persistBackground}
      />

      {/* ─── Toolbar ───────────────────────────────────────────────────── */}
      <Toolbar
        activeIndex={active ? slides.findIndex((s) => s.id === active.id) : 0}
        totalSlides={slides.length}
        analyzing={analyzing}
        totalSuggestions={totalActive}
        onReAnalyze={runAnalyze}
        onExport={onExport}
        exporting={exporting}
      />

      {/* ─── 3-pane body ────────────────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_320px] divide-x divide-border">
        <SlideThumbList
          slides={slides}
          activeId={active?.id ?? null}
          analysis={analysis}
          onPick={setActiveId}
        />
        <SlideEditorCanvas
          slide={active}
          index={active ? slides.findIndex((s) => s.id === active.id) : 0}
          total={slides.length}
          deckTitle={deckTitle}
          themeId={themeId}
          backgroundHex={backgroundHex}
          viewMode={viewMode}
          onViewMode={setViewMode}
          activeSuggestions={activeSuggestions}
          onPrev={goPrev}
          onNext={goNext}
          onLocalEdit={updateLocal}
          onPersist={persistSlide}
          savingId={savingId}
        />
        <AiPanel
          tab={rightTab}
          setTab={setRightTab}
          analysis={analysis}
          analyzing={analyzing}
          analyzeError={analyzeError}
          onReAnalyze={runAnalyze}
          slides={slides}
          activeId={active?.id ?? null}
          onFocusSlide={setActiveId}
          onApply={openApply}
          onDismiss={dismiss}
          applyingId={applyingId}
          refineIntent={refineIntent}
          setRefineIntent={setRefineIntent}
          refineInput={refineInput}
          setRefineInput={setRefineInput}
          refining={refining}
          onSendRefine={sendRefine}
        />
      </div>

      {/* Save errors live at the bottom edge */}
      <AnimatePresence>
        {saveError && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-rose-600 px-4 py-2 text-xs text-white shadow-lg"
            data-testid="studio-error"
          >
            {saveError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Diff modal for apply / refine results */}
      <DeckDiffModal
        open={!!diffProposal}
        proposal={diffProposal}
        loading={false}
        committing={diffCommitting}
        error={diffError}
        onAccept={commitDiff}
        onCancel={closeDiff}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Topbar
// ═══════════════════════════════════════════════════════════════════════════

function Topbar({
  deckTitle,
  sourceLabel,
  status,
  savingId,
  onFinalize,
  finalizing,
  isFinalized,
  themeId,
  onThemeChange,
  backgroundHex,
  onBackgroundChange,
}: {
  deckTitle: string;
  sourceLabel: string;
  status: DeckForgeStatus;
  savingId: string | null;
  onFinalize: () => void;
  finalizing: boolean;
  isFinalized: boolean;
  themeId: string;
  onThemeChange: (id: string) => void;
  backgroundHex: string | null;
  onBackgroundChange: (hex: string | null) => void;
}) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Link
          href="/teacher/decks/new"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Wizard
        </Link>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">Studio</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="truncate font-medium" title={deckTitle} data-testid="studio-deck-title">
          {deckTitle}
        </span>
        <span className="ml-2 hidden text-[10px] text-muted-foreground md:inline">{sourceLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <ThemePicker value={themeId} onChange={onThemeChange} />
        <BackgroundPicker
          value={backgroundHex}
          themeDefault={getDeckTheme(themeId).bg}
          onChange={onBackgroundChange}
          onReset={() => onBackgroundChange(null)}
        />
        <span className="h-4 w-px bg-border" />
        <SaveIndicator savingId={savingId} />
        {isFinalized ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            data-testid="studio-finalized-badge"
          >
            <Lock className="h-3.5 w-3.5" />
            Finalized
          </span>
        ) : (
          <button
            type="button"
            onClick={onFinalize}
            disabled={finalizing}
            data-testid="studio-finalize"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {finalizing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Finalize
          </button>
        )}
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {status.toLowerCase().replace(/_/g, ' ')}
        </span>
      </div>
    </header>
  );
}

function SaveIndicator({ savingId }: { savingId: string | null }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {savingId ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </>
      ) : (
        <>
          <Check className="h-3 w-3 text-emerald-500" />
          Saved
        </>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Toolbar
// ═══════════════════════════════════════════════════════════════════════════

function Toolbar({
  activeIndex,
  totalSlides,
  analyzing,
  totalSuggestions,
  onReAnalyze,
  onExport,
  exporting,
}: {
  activeIndex: number;
  totalSlides: number;
  analyzing: boolean;
  totalSuggestions: number;
  onReAnalyze: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-border bg-card/60 px-4 text-xs">
      <span className="font-mono text-muted-foreground">
        Slide {activeIndex + 1} / {totalSlides}
      </span>
      <div className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onReAnalyze}
        disabled={analyzing}
        data-testid="studio-reanalyze"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        {analyzing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {analyzing ? 'Analyzing…' : 'Re-analyze'}
      </button>
      {totalSuggestions > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
          data-testid="studio-pending-count"
        >
          {totalSuggestions} pending
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          data-testid="studio-export"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Export pptx
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-teal-500/15 px-2 py-1 text-teal-700 transition hover:bg-teal-500/25 dark:text-teal-300"
        >
          <Presentation className="h-3 w-3" />
          Present
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Left pane — SlideThumbList
// ═══════════════════════════════════════════════════════════════════════════

function SlideThumbList({
  slides,
  activeId,
  analysis,
  onPick,
}: {
  slides: SlideViewModel[];
  activeId: string | null;
  analysis: DeckAnalysisResult | null;
  onPick: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Slides</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tracking-normal normal-case text-muted-foreground">
          {slides.length}
        </span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5" data-testid="studio-thumblist">
        {slides.map((s, i) => {
          const count = analysis ? countActive(analysis.suggestions, s.id) : 0;
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              data-testid={`studio-thumb-${i}`}
              data-active={isActive ? 'true' : 'false'}
              className={`group relative w-full overflow-hidden rounded-md border-2 text-left transition ${
                isActive
                  ? 'border-foreground/80 ring-2 ring-foreground/10'
                  : 'border-border hover:border-foreground/30'
              }`}
            >
              <div className="aspect-video bg-linear-to-br from-slate-900 to-slate-800 p-2 text-[8px] text-white">
                <div className="line-clamp-2 font-semibold leading-tight">{s.title}</div>
                {s.bullets.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[6px] leading-tight text-white/70">
                    {s.bullets.slice(0, 2).map((b, j) => (
                      <li key={j} className="line-clamp-1">
                        • {b}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="absolute bottom-1 left-1.5 font-mono text-[8px] text-white/40">
                {String(i + 1).padStart(2, '0')}
              </div>
              <SlideIssueBadge count={count} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function SlideIssueBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">
        <Check className="h-2.5 w-2.5" />
      </span>
    );
  }
  return (
    <span
      className={`absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${
        count >= 5 ? 'bg-rose-600' : 'bg-amber-500'
      }`}
    >
      {count}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Center pane — SlideEditorCanvas (with annotation pins + edit overlay)
// ═══════════════════════════════════════════════════════════════════════════

function SlideEditorCanvas({
  slide,
  index,
  total,
  deckTitle,
  themeId,
  backgroundHex,
  viewMode,
  onViewMode,
  activeSuggestions,
  onPrev,
  onNext,
  onLocalEdit,
  onPersist,
  savingId,
}: {
  slide: SlideViewModel | null;
  index: number;
  total: number;
  deckTitle: string;
  themeId: string;
  backgroundHex: string | null;
  viewMode: 'original' | 'editable';
  onViewMode: (m: 'original' | 'editable') => void;
  activeSuggestions: DeckSuggestion[];
  onPrev: () => void;
  onNext: () => void;
  onLocalEdit: (id: string, patch: Partial<SlideViewModel>) => void;
  onPersist: (id: string, patch: Partial<SlideViewModel>) => Promise<void>;
  savingId: string | null;
}) {
  const [editMode, setEditMode] = useState(false);

  if (!slide) {
    return (
      <section className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No slides
      </section>
    );
  }

  return (
    <section className="relative flex min-h-0 flex-col items-center justify-center bg-muted/40 p-8">
      <div className="relative w-full max-w-3xl">
        {viewMode === 'original' && slide.sourceImageUrl ? (
          // Faithful import: the uploaded slide exactly as-is.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slide.sourceImageUrl}
            alt={slide.title}
            className="block w-full rounded-xl"
            style={{ aspectRatio: '16 / 9', objectFit: 'contain', background: '#000' }}
          />
        ) : (
          <SlideCanvas
            slide={slide}
            index={index}
            total={total}
            deckTitle={deckTitle}
            themeId={themeId}
            backgroundHex={backgroundHex}
            mode="preview"
          />
        )}
        {/* Original | Editable — only when this slide has a faithful original. */}
        {slide.sourceImageUrl && (
          <div className="absolute left-2 top-2 inline-flex rounded-md bg-white/10 p-0.5 text-[10px] font-medium text-white backdrop-blur">
            {(['original', 'editable'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onViewMode(m)}
                className={`rounded px-2 py-1 capitalize transition ${
                  viewMode === m ? 'bg-white/25' : 'hover:bg-white/15'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {/* Annotation pins — fixed corners by suggestion kind */}
        {activeSuggestions.slice(0, 4).map((s, i) => (
          <AnnotationPin key={s.id} suggestion={s} cornerIndex={i} />
        ))}
        {/* Edit toggle */}
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[10px] font-medium text-white backdrop-blur transition hover:bg-white/20"
          data-testid="studio-edit-toggle"
        >
          {editMode ? <Eye className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
          {editMode ? 'Preview' : 'Edit'}
        </button>
      </div>

      {/* Edit overlay (text-only — title / bullets / notes) */}
      {editMode && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 w-full max-w-3xl space-y-2.5 rounded-2xl border border-border bg-card p-4"
        >
          <input
            value={slide.title}
            onChange={(e) => onLocalEdit(slide.id, { title: e.target.value })}
            onBlur={(e) => onPersist(slide.id, { title: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium"
            data-testid="studio-edit-title"
          />
          <BulletEditor slide={slide} onLocalEdit={onLocalEdit} onPersist={onPersist} />
          <textarea
            value={slide.speakerNotes ?? ''}
            onChange={(e) => onLocalEdit(slide.id, { speakerNotes: e.target.value })}
            onBlur={(e) =>
              onPersist(slide.id, { speakerNotes: e.target.value.trim() || null })
            }
            placeholder="Speaker notes"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-muted-foreground"
            data-testid="studio-edit-notes"
          />
        </motion.div>
      )}

      {/* Slide nav */}
      <nav className="mt-4 flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={onPrev}
          disabled={index === 0}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 transition hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </button>
        <span className="font-mono text-muted-foreground">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={index >= total - 1}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 transition hover:bg-muted disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {savingId === slide.id && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving
          </span>
        )}
      </nav>
    </section>
  );
}

function BulletEditor({
  slide,
  onLocalEdit,
  onPersist,
}: {
  slide: SlideViewModel;
  onLocalEdit: (id: string, patch: Partial<SlideViewModel>) => void;
  onPersist: (id: string, patch: Partial<SlideViewModel>) => Promise<void>;
}) {
  return (
    <div className="space-y-1.5">
      {slide.bullets.map((b, i) => (
        <input
          key={i}
          value={b}
          onChange={(e) => {
            const next = [...slide.bullets];
            next[i] = e.target.value;
            onLocalEdit(slide.id, { bullets: next });
          }}
          onBlur={() => onPersist(slide.id, { bullets: slide.bullets })}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
        />
      ))}
    </div>
  );
}

function AnnotationPin({
  suggestion,
  cornerIndex,
}: {
  suggestion: DeckSuggestion;
  cornerIndex: number;
}) {
  const corners = [
    'left-3 top-3',
    'right-3 top-3',
    'left-3 bottom-3',
    'right-3 bottom-3',
  ];
  const tone = SEVERITY_TONE[suggestion.severity];
  const Icon = KIND_ICON[suggestion.kind] ?? Sparkles;
  return (
    <div className={`absolute ${corners[cornerIndex]} z-10 flex items-center gap-1.5`}>
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full shadow-lg ring-2 ${tone.ring} ${tone.chip}`}
        title={suggestion.message}
      >
        <Icon className="h-3 w-3" />
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Right pane — AiPanel with 3 tabs + refine chat
// ═══════════════════════════════════════════════════════════════════════════

function AiPanel({
  tab,
  setTab,
  analysis,
  analyzing,
  analyzeError,
  onReAnalyze,
  slides,
  activeId,
  onFocusSlide,
  onApply,
  onDismiss,
  applyingId,
  refineIntent,
  setRefineIntent,
  refineInput,
  setRefineInput,
  refining,
  onSendRefine,
}: {
  tab: RightTab;
  setTab: (t: RightTab) => void;
  analysis: DeckAnalysisResult | null;
  analyzing: boolean;
  analyzeError: string | null;
  onReAnalyze: () => void;
  slides: SlideViewModel[];
  activeId: string | null;
  onFocusSlide: (id: string) => void;
  onApply: (s: DeckSuggestion) => void;
  onDismiss: (s: DeckSuggestion) => void;
  applyingId: string | null;
  refineIntent: RefineIntent;
  setRefineIntent: (i: RefineIntent) => void;
  refineInput: string;
  setRefineInput: (s: string) => void;
  refining: boolean;
  onSendRefine: () => void;
}) {
  const tabs: Array<{ id: RightTab; label: string }> = [
    { id: 'analysis', label: 'Analysis' },
    { id: 'suggestions', label: 'Suggestions' },
    { id: 'interactions', label: 'Interactions' },
  ];

  return (
    <aside className="flex min-h-0 flex-col bg-card" data-testid="studio-ai-panel">
      <nav className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            data-testid={`studio-tab-${t.id}`}
            data-active={tab === t.id ? 'true' : 'false'}
            className={`relative flex-1 py-2.5 text-[11px] font-medium transition ${
              tab === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {tab === t.id && (
              <motion.div
                layoutId="studio-tab-underline"
                className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
              />
            )}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'analysis' && (
          <AnalysisTab
            analysis={analysis}
            analyzing={analyzing}
            analyzeError={analyzeError}
            onReAnalyze={onReAnalyze}
          />
        )}
        {tab === 'suggestions' && (
          <SuggestionsTab
            analysis={analysis}
            slides={slides}
            activeId={activeId}
            onFocusSlide={onFocusSlide}
            onApply={onApply}
            onDismiss={onDismiss}
            applyingId={applyingId}
          />
        )}
        {tab === 'interactions' && (
          <InteractionsTab
            analysis={analysis}
            slides={slides}
            onFocusSlide={onFocusSlide}
            onApply={onApply}
            applyingId={applyingId}
          />
        )}
      </div>

      {/* Refine chat footer — flex-shrink-0 so the toggle/input never get
          pushed below the visible viewport, regardless of suggestion list
          length. */}
      <footer className="shrink-0 border-t border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1">
          <IntentToggle intent={refineIntent} setIntent={setRefineIntent} />
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={refineInput}
            onChange={(e) => setRefineInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && refineInput.trim() && !refining) {
                e.preventDefault();
                onSendRefine();
              }
            }}
            placeholder="Ask AI: 'tighten these bullets'…"
            className="flex-1 rounded-md border border-input bg-background px-2.5 py-2 text-xs"
            data-testid="studio-refine-input"
            disabled={refining}
          />
          <button
            type="button"
            onClick={onSendRefine}
            disabled={refining || !refineInput.trim()}
            data-testid="studio-refine-send"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </footer>
    </aside>
  );
}

function IntentToggle({
  intent,
  setIntent,
}: {
  intent: RefineIntent;
  setIntent: (i: RefineIntent) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/60 p-0.5 text-[11px]">
      <button
        type="button"
        onClick={() => setIntent('english')}
        aria-pressed={intent === 'english'}
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition ${
          intent === 'english'
            ? 'bg-foreground text-background shadow-sm'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <Languages className="h-3 w-3" />
        English
      </button>
      <button
        type="button"
        onClick={() => setIntent('content')}
        aria-pressed={intent === 'content'}
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition ${
          intent === 'content'
            ? 'bg-foreground text-background shadow-sm'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <Brain className="h-3 w-3" />
        Content
      </button>
    </div>
  );
}

// ─── Analysis tab ──────────────────────────────────────────────────────────

function AnalysisTab({
  analysis,
  analyzing,
  analyzeError,
  onReAnalyze,
}: {
  analysis: DeckAnalysisResult | null;
  analyzing: boolean;
  analyzeError: string | null;
  onReAnalyze: () => void;
}) {
  if (analyzing && !analysis) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Analyzing your deck…
      </div>
    );
  }
  if (!analysis) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs">
        {analyzeError && (
          <div className="rounded-md bg-rose-500/10 px-3 py-2 text-rose-700 dark:text-rose-300">
            {analyzeError}
          </div>
        )}
        <p className="text-muted-foreground">No analysis yet.</p>
        <button
          type="button"
          onClick={onReAnalyze}
          className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90"
        >
          <Sparkles className="h-3 w-3" />
          Run analysis
        </button>
      </div>
    );
  }

  const composite =
    (analysis.readabilityScore + analysis.slideDensityScore + analysis.visualBalanceScore) / 3;

  return (
    <div className="space-y-4 p-4">
      {/* Score hero */}
      <div className={`rounded-xl bg-linear-to-br ${scoreBg(composite)} p-4`} data-testid="studio-score-card">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Composite score
          </div>
          <div className={`text-2xl font-bold tabular-nums ${scoreTone(composite)}`}>
            {composite.toFixed(1)}
            <span className="text-sm font-medium text-muted-foreground"> / 10</span>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-foreground/40"
            style={{ width: `${Math.min(100, composite * 10)}%` }}
          />
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-2" data-testid="studio-metric-grid">
        <MetricCard label="Readability" value={analysis.readabilityScore} />
        <MetricCard label="Density" value={analysis.slideDensityScore} />
        <MetricCard label="Balance" value={analysis.visualBalanceScore} />
        <MetricCard
          label="Suggestions"
          value={analysis.suggestions.filter((s) => !s.dismissedAt && !s.appliedAt).length}
          asCount
        />
      </div>

      {/* Notes */}
      {analysis.notes && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
          {analysis.notes}
        </div>
      )}

      {/* Pass badges */}
      <div className="flex items-center gap-2 text-[10px]">
        <PassBadge label="Clinical review" pass={analysis.passes?.review} />
        <PassBadge label="Design review" pass={analysis.passes?.design} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, asCount }: { label: string; value: number; asCount?: boolean }) {
  const tone = asCount ? 'text-foreground' : scoreTone(value);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>
        {asCount ? value : value.toFixed(1)}
        {!asCount && <span className="text-xs font-medium text-muted-foreground"> /10</span>}
      </div>
    </div>
  );
}

function PassBadge({
  label,
  pass,
}: {
  label: string;
  pass?: 'ok' | 'failed' | 'skipped';
}) {
  const tone =
    pass === 'ok'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : pass === 'failed'
        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${tone}`}>
      <CircleDot className="h-2.5 w-2.5" />
      {label} {pass ? `· ${pass}` : ''}
    </span>
  );
}

// ─── Suggestions tab ───────────────────────────────────────────────────────

function SuggestionsTab({
  analysis,
  slides,
  activeId,
  onFocusSlide,
  onApply,
  onDismiss,
  applyingId,
}: {
  analysis: DeckAnalysisResult | null;
  slides: SlideViewModel[];
  activeId: string | null;
  onFocusSlide: (id: string) => void;
  onApply: (s: DeckSuggestion) => void;
  onDismiss: (s: DeckSuggestion) => void;
  applyingId: string | null;
}) {
  const groups = useMemo(() => {
    if (!analysis) return { active: [], other: [] };
    const live = analysis.suggestions.filter((s) => !s.dismissedAt && !s.appliedAt);
    return {
      active: live.filter((s) => s.slideId === activeId),
      other: live.filter((s) => s.slideId !== activeId),
    };
  }, [analysis, activeId]);

  if (!analysis) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
        Run analysis to see suggestions
      </div>
    );
  }

  if (groups.active.length + groups.other.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs">
        <CheckCircle2 className="h-6 w-6 text-emerald-500" />
        <p className="text-muted-foreground">No outstanding suggestions. Deck looks good.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" data-testid="studio-suggestions-list">
      {groups.active.length > 0 && (
        <SuggestionsGroup
          title="This slide"
          items={groups.active}
          slides={slides}
          onFocusSlide={onFocusSlide}
          onApply={onApply}
          onDismiss={onDismiss}
          applyingId={applyingId}
        />
      )}
      {groups.other.length > 0 && (
        <SuggestionsGroup
          title="Elsewhere in the deck"
          items={groups.other}
          slides={slides}
          onFocusSlide={onFocusSlide}
          onApply={onApply}
          onDismiss={onDismiss}
          applyingId={applyingId}
        />
      )}
    </div>
  );
}

function SuggestionsGroup({
  title,
  items,
  slides,
  onFocusSlide,
  onApply,
  onDismiss,
  applyingId,
}: {
  title: string;
  items: DeckSuggestion[];
  slides: SlideViewModel[];
  onFocusSlide: (id: string) => void;
  onApply: (s: DeckSuggestion) => void;
  onDismiss: (s: DeckSuggestion) => void;
  applyingId: string | null;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {items.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              slides={slides}
              onFocusSlide={onFocusSlide}
              onApply={onApply}
              onDismiss={onDismiss}
              applyingId={applyingId}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  slides,
  onFocusSlide,
  onApply,
  onDismiss,
  applyingId,
}: {
  suggestion: DeckSuggestion;
  slides: SlideViewModel[];
  onFocusSlide: (id: string) => void;
  onApply: (s: DeckSuggestion) => void;
  onDismiss: (s: DeckSuggestion) => void;
  applyingId: string | null;
}) {
  const Icon = KIND_ICON[suggestion.kind] ?? Sparkles;
  const tone = SEVERITY_TONE[suggestion.severity];
  const slideIdx = suggestion.slideId
    ? slides.findIndex((s) => s.id === suggestion.slideId)
    : -1;
  const isApplying = applyingId === suggestion.id;
  // Deck-level suggestions (slideId null) can't be auto-applied — the apply
  // path rewrites one slide's text. Show a 'manual action' label instead.
  const isDeckLevel = !suggestion.slideId;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="rounded-lg border border-border bg-card p-3 transition hover:border-foreground/30"
    >
      <div className="flex items-start gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tone.chip}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold">{KIND_LABEL[suggestion.kind]}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${tone.chip}`}
            >
              {suggestion.severity}
            </span>
            {slideIdx >= 0 && (
              <button
                type="button"
                onClick={() => onFocusSlide(suggestion.slideId!)}
                className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground transition hover:bg-foreground/10"
              >
                Slide {slideIdx + 1}
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {suggestion.message}
          </p>
          {suggestion.proposedAction && (
            <p className="mt-1 rounded-md bg-muted/40 px-2 py-1 text-[10px] italic text-muted-foreground">
              → {suggestion.proposedAction}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            {isDeckLevel ? (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground"
                title="This is deck-level advice (no specific slide). Teacher judgment needed."
              >
                <Sparkles className="h-2.5 w-2.5" />
                Manual action
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onApply(suggestion)}
                disabled={isApplying}
                data-testid={`studio-apply-${suggestion.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background transition hover:opacity-90 disabled:opacity-50"
              >
                {isApplying ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Sparkles className="h-2.5 w-2.5" />
                )}
                Apply
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(suggestion)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-muted"
            >
              <X className="h-2.5 w-2.5" />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Interactions tab ──────────────────────────────────────────────────────

function InteractionsTab({
  analysis,
  slides,
  onFocusSlide,
  onApply,
  applyingId,
}: {
  analysis: DeckAnalysisResult | null;
  slides: SlideViewModel[];
  onFocusSlide: (id: string) => void;
  onApply: (s: DeckSuggestion) => void;
  applyingId: string | null;
}) {
  const interactions = useMemo(
    () =>
      analysis?.suggestions.filter(
        (s) =>
          s.kind === 'INTERACTION_POINT' && !s.dismissedAt && !s.appliedAt,
      ) ?? [],
    [analysis],
  );

  if (interactions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs">
        <MessageSquare className="h-6 w-6 text-muted-foreground" />
        <p className="text-muted-foreground">
          AI didn&apos;t flag any interaction insertion points yet. Use the refine chat below to ask:
          &quot;where should I add a poll?&quot;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Suggested interactions
      </p>
      {interactions.map((s) => {
        const slideIdx = s.slideId ? slides.findIndex((x) => x.id === s.slideId) : -1;
        // Deck-level suggestions (slideId null) can't be auto-applied: they
        // typically mean "add a whole new slide here", which the per-slide
        // refine path can't do. Slide-insertion via the Apply flow lands in
        // Phase 2D.2. Until then, show a manual-action note instead of an
        // Insert button that the server rightly refuses.
        const isDeckLevel = !s.slideId;
        return (
          <div
            key={s.id}
            className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-3 text-[11px]"
          >
            <div className="flex items-start gap-2">
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
              <div className="flex-1">
                <p className="leading-relaxed text-foreground">{s.message}</p>
                <div className="mt-2 flex items-center gap-2">
                  {slideIdx >= 0 && (
                    <button
                      type="button"
                      onClick={() => onFocusSlide(s.slideId!)}
                      className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground transition hover:bg-foreground/10"
                    >
                      Slide {slideIdx + 1}
                    </button>
                  )}
                  {isDeckLevel ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      <Sparkles className="h-2.5 w-2.5" />
                      Add slide manually
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onApply(s)}
                      disabled={applyingId === s.id}
                      className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2 py-1 text-[10px] font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
                    >
                      {applyingId === s.id ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-2.5 w-2.5" />
                      )}
                      Insert
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

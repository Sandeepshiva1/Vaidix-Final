'use client';

// ════════════════════════════════════════════════════════════════════════════
// Deck editor — restyled to match the demo studio workbench. 3-column layout:
// LEFT = source label + slide thumbnails (reorder), CENTER = PowerPoint-style
// ribbon + large slide canvas, RIGHT = tabbed Edit / AI Coach panel.
// Slides persist via PATCH /api/decks/[jobId]/slides/[slideId];
// reorder via POST /api/decks/[jobId]/reorder. All behavior preserved — only
// markup/Tailwind/layout changed.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AArrowDown,
  AArrowUp,
  ArrowLeft,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  ImagePlus,
  Italic,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Table as TableIcon,
  Trash2,
  Underline,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SlideCanvas,
  type SlideViewModel,
  type SlideTable,
} from '@/components/decks/slide-canvas';
import { DeckAiCoach } from '@/components/decks/deck-ai-coach';
import { ThemePicker } from '@/components/decks/theme-picker';
import { BackgroundPicker } from '@/components/decks/background-picker';
import { DECK_THEMES, THEME_IDS, getDeckTheme } from '@/lib/deck-themes';
import type { DeckAnalysisResult } from '@/server/services/decks/deck-analyze-service';
import { DeckForgeStatus } from '@prisma/client';
import type { SlideLayout } from '@prisma/client';
import { csrfHeaders } from '@/lib/csrf-client';

// Bounds mirror the slide PATCH API (TableSchema) so the client never builds a
// table the server will reject.
const MAX_TABLE_ROWS = 12;
const MAX_TABLE_COLS = 8;
const FONT_SCALE_MIN = 0.6;
const FONT_SCALE_MAX = 1.6;

function newTable(): SlideTable {
  return { rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']] };
}

const LAYOUT_OPTIONS: SlideLayout[] = [
  'TITLE_ONLY',
  'TITLE_BULLETS',
  'TWO_COLUMN',
  'IMAGE_FOCUS',
  'QUOTE',
  'INTERACTION',
  'CLOSING',
];

const RIBBON_TABS = ['Home', 'Insert', 'Design'] as const;
type RibbonTab = (typeof RIBBON_TABS)[number];

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
  /** 'VERBATIM' when the deck was imported as-is (offers the Original view). */
  importMode?: string;
  /**
   * When set, the editor is rendered inside the session pre-conference flow:
   * the Back link returns to /session/[id]/pre and a primary "Finalize" button
   * appears (locks the deck, then returns to the hub). Undefined = standalone
   * /teacher/decks use, where behavior is unchanged.
   */
  backToSessionId?: string;
}

type RightTab = 'edit' | 'coach';

export function DeckEditorClient({
  jobId,
  deckTitle,
  status,
  sourceLabel,
  initialSlides,
  initialAnalysis,
  initialTheme,
  initialBackgroundHex,
  importMode,
  backToSessionId,
}: Props) {
  const router = useRouter();
  const [slides, setSlides] = useState<SlideViewModel[]>(initialSlides);
  const [activeId, setActiveId] = useState<string | null>(initialSlides[0]?.id ?? null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  // Per-slide AI image state: which slide is generating, and which (if any)
  // hit the offline (503) path so the panel can show an inline note.
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const [imageOfflineId, setImageOfflineId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('coach');
  const [themeId, setThemeId] = useState<string>(initialTheme ?? 'deep-space');
  const [backgroundHex, setBackgroundHex] = useState<string | null>(initialBackgroundHex ?? null);
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('Home');
  // Faithful-import view toggle. VERBATIM decks default to the pixel-faithful
  // "Original" (the uploaded slide image); everyone can switch to the editable
  // Vaidix canvas. Only meaningful when the active slide has an original image.
  const [viewMode, setViewMode] = useState<'original' | 'editable'>(
    importMode === 'VERBATIM' ? 'original' : 'editable',
  );
  // ── Present gating ────────────────────────────────────────────────────────
  // Present is only allowed on a finalized deck with no edits since that
  // finalize: faculty must always Finalize → then Present. `finalized` seeds
  // from the deck status (APPROVED = previously finalized); any mutation flips
  // `dirty` true, which re-locks Present until the next Finalize.
  const [finalized, setFinalized] = useState(status === DeckForgeStatus.APPROVED);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const active = useMemo(
    () => slides.find((s) => s.id === activeId) ?? slides[0] ?? null,
    [slides, activeId],
  );

  // Any persisted change since the last finalize re-locks Present.
  const markDirty = useCallback(() => setDirty(true), []);
  const canPresent = finalized && !dirty;

  const updateLocal = useCallback((id: string, patch: Partial<SlideViewModel>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  async function persistSlide(id: string, body: Partial<SlideViewModel>) {
    markDirty();
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/slides/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Save failed (${res.status})`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function persistTheme(id: string) {
    markDirty();
    setThemeId(id);
    try {
      const res = await fetch(`/api/decks/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ template: id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Theme save failed (${res.status})`);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Persist a background override (hex, no '#') or null to reset to the theme.
  async function persistBackground(hex: string | null) {
    markDirty();
    setBackgroundHex(hex);
    try {
      const res = await fetch(`/api/decks/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ backgroundHex: hex }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Background save failed (${res.status})`);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function move(id: string, delta: -1 | 1) {
    markDirty();
    setSlides((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const next = idx + delta;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = prev.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy.map((s, i) => ({ ...s, order: i }));
    });
  }

  async function persistOrder() {
    markDirty();
    setError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ order: slides.map((s) => s.id) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? 'Reorder failed');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function generateImage(id: string) {
    markDirty();
    setImageBusyId(id);
    setImageOfflineId(null);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/slides/${id}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({}),
      });
      if (res.status === 503) {
        setImageOfflineId(id);
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Image generation failed (${res.status})`);
      }
      const j = (await res.json()) as {
        data: { imageS3Key: string | null; imageUrl: string | null };
      };
      updateLocal(id, { imageS3Key: j.data.imageS3Key, imageUrl: j.data.imageUrl });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImageBusyId(null);
    }
  }

  async function removeImage(id: string) {
    markDirty();
    setImageBusyId(id);
    setImageOfflineId(null);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/slides/${id}/image`, {
        method: 'DELETE',
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Remove failed (${res.status})`);
      }
      updateLocal(id, { imageS3Key: null, imageUrl: null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImageBusyId(null);
    }
  }

  // Upload an image file (Insert > Image). Multipart PUT — we deliberately omit
  // Content-Type so the browser sets the multipart boundary itself.
  async function uploadImage(id: string, file: File) {
    markDirty();
    setImageBusyId(id);
    setImageOfflineId(null);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/decks/${jobId}/slides/${id}/image`, {
        method: 'PUT',
        headers: { ...csrfHeaders() },
        body: form,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Upload failed (${res.status})`);
      }
      const j = (await res.json()) as {
        data: { imageS3Key: string | null; imageUrl: string | null };
      };
      updateLocal(id, { imageS3Key: j.data.imageS3Key, imageUrl: j.data.imageUrl });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImageBusyId(null);
    }
  }

  // Opens the OS file picker; the hidden <input> in the center pane handles the
  // selected file. Shared by the Insert ribbon and the Edit panel.
  function pickImage() {
    if (!active) return;
    fileInputRef.current?.click();
  }

  // ── Ribbon Home: slide-level text formatting ──────────────────────────────
  function toggleFmt(field: 'bold' | 'italic' | 'underline') {
    if (!active) return;
    const patch = { [field]: !active[field] } as Partial<SlideViewModel>;
    updateLocal(active.id, patch);
    void persistSlide(active.id, patch);
  }

  function changeFontScale(delta: number) {
    if (!active) return;
    const cur = active.fontScale ?? 1;
    const next = Math.min(
      FONT_SCALE_MAX,
      Math.max(FONT_SCALE_MIN, Math.round((cur + delta) * 100) / 100),
    );
    if (next === cur) return;
    updateLocal(active.id, { fontScale: next });
    void persistSlide(active.id, { fontScale: next });
  }

  // ── Ribbon Insert: table ──────────────────────────────────────────────────
  function insertTable() {
    if (!active) return;
    setRightTab('edit'); // jump to the table editor either way
    if (active.tableJson) return; // already has one — just reveal the editor
    const tableJson = newTable();
    updateLocal(active.id, { tableJson });
    void persistSlide(active.id, { tableJson });
  }

  function removeTable() {
    if (!active) return;
    updateLocal(active.id, { tableJson: null });
    void persistSlide(active.id, { tableJson: null });
  }

  async function exportPptx() {
    setExporting(true);
    setError(null);
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
      a.download = `${deckTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  // Lock the deck (APPROVED) and mark it clean so Present unlocks. We stay in
  // the editor so faculty can immediately Present (the "Back to session" link
  // still returns to the pre-conf hub, which derives the step as done once a
  // deck is approved). Any later edit flips `dirty` and re-locks Present until
  // the next Finalize.
  async function finalizeDeck() {
    setFinalizing(true);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/finalize`, {
        method: 'POST',
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Finalize failed (${res.status})`);
      }
      setFinalized(true);
      setDirty(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFinalizing(false);
    }
  }

  const activeIndex = active ? slides.findIndex((s) => s.id === active.id) : -1;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border/60 bg-background/50 px-6 py-3 backdrop-blur">
        <div className="min-w-0">
          <Link
            href={backToSessionId ? `/session/${backToSessionId}/pre` : '/teacher/documents'}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {backToSessionId ? 'Back to session' : 'Back to documents'}
          </Link>
          <h1 className="mt-1 truncate text-[19px] font-semibold tracking-tight">{deckTitle}</h1>
          <p className="text-[11.5px] text-muted-foreground">
            {sourceLabel} · {slides.length} slides · {status}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ThemePicker value={themeId} onChange={persistTheme} />
          <BackgroundPicker
            value={backgroundHex}
            themeDefault={getDeckTheme(themeId).bg}
            onChange={persistBackground}
            onReset={() => persistBackground(null)}
          />

          <span className="h-5 w-px bg-border/60" />

          {error && <span className="text-[11.5px] text-destructive">{error}</span>}
          <button
            type="button"
            onClick={persistOrder}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            Save order
          </button>
          <button
            type="button"
            onClick={exportPptx}
            disabled={exporting}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
          >
            <Download className="size-3.5" />
            {exporting ? 'Exporting…' : 'Export .pptx'}
          </button>
          {/* Present is gated on a finalized + unedited deck — Finalize first. */}
          {canPresent ? (
            <Link
              href={`/teacher/decks/${jobId}/present`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-5 text-[12.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] dark:bg-slate-700"
            >
              <Eye className="size-3.5" />
              Present
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={
                finalized
                  ? 'Finalize your latest edits to present'
                  : 'Finalize the deck to present'
              }
              className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-full bg-foreground/10 px-5 text-[12.5px] font-medium text-muted-foreground"
            >
              <Eye className="size-3.5" />
              Present
            </button>
          )}

          {/* Finalize locks the deck and unlocks Present; shows a done state
              while the deck stays clean, and re-arms after any edit. */}
          {canPresent ? (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 text-[12.5px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" />
              Finalized
            </span>
          ) : (
            <button
              type="button"
              onClick={finalizeDeck}
              disabled={finalizing || slides.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-linear-to-r from-teal-600 to-emerald-600 px-5 text-[12.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {finalizing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Finalizing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5" />
                  Finalize
                </>
              )}
            </button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr_360px] gap-0 overflow-hidden">
        {/* ── LEFT panel — source + slide thumbnails ───────────────────── */}
        <aside className="flex h-full min-h-0 flex-col border-r border-border/60 bg-background/30">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="text-[12.5px] font-semibold">Source material</div>
          </div>
          <div className="border-b border-border/60 px-4 py-3">
            <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
              {sourceLabel}
            </div>
          </div>

          {/* Slide thumbs */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div className="text-[12.5px] font-semibold">Slides</div>
              <span className="text-[11px] text-muted-foreground">{slides.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <ol className="space-y-2">
                <AnimatePresence initial={false}>
                  {slides.map((s, i) => (
                    <motion.li
                      key={s.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="group"
                    >
                      <button
                        type="button"
                        onClick={() => setActiveId(s.id)}
                        className={cn(
                          'group/btn relative block w-full overflow-hidden rounded-xl border text-left transition-all',
                          s.id === activeId
                            ? 'border-teal-500/50 ring-2 ring-teal-500/20'
                            : 'border-border/60 hover:border-foreground/20',
                        )}
                      >
                        <div className="flex items-center justify-between px-2.5 pt-2 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                          <span className="font-mono font-semibold tabular-nums">{i + 1}</span>
                          <span>{s.layout}</span>
                        </div>
                        <div className="overflow-hidden p-1.5">
                          <div className="overflow-hidden rounded-lg">
                            <SlideCanvas
                              slide={s}
                              index={i}
                              total={slides.length}
                              deckTitle={deckTitle}
                              themeId={themeId}
                              backgroundHex={backgroundHex}
                            />
                          </div>
                        </div>
                        <p className="line-clamp-2 px-2.5 pb-2 text-[10.5px] font-medium leading-tight text-foreground/80">
                          {s.title}
                        </p>
                      </button>
                      <div className="mt-1 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label="Move up"
                          onClick={() => move(s.id, -1)}
                          className="grid size-6 place-items-center rounded-md border border-border/60 bg-background/60 text-muted-foreground hover:bg-foreground/5 disabled:opacity-30"
                          disabled={i === 0}
                        >
                          <ChevronUp className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          onClick={() => move(s.id, 1)}
                          className="grid size-6 place-items-center rounded-md border border-border/60 bg-background/60 text-muted-foreground hover:bg-foreground/5 disabled:opacity-30"
                          disabled={i === slides.length - 1}
                        >
                          <ChevronDown className="size-3" />
                        </button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            </div>
          </div>
        </aside>

        {/* ── CENTER — ribbon + canvas ─────────────────────────────────── */}
        <section className="flex h-full min-h-0 min-w-0 flex-col bg-linear-to-br from-slate-50/60 via-background to-teal-50/30 dark:from-background dark:to-background">
          {/* PowerPoint-style ribbon */}
          <div className="shrink-0 border-b border-border/60 bg-white/95 dark:bg-background/95">
            <div className="flex items-center gap-0 border-b border-border/40 px-2">
              {RIBBON_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setRibbonTab(tab)}
                  className={cn(
                    'px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-foreground/5',
                    ribbonTab === tab
                      ? 'border-b-2 border-teal-500 text-teal-700 dark:text-teal-300'
                      : 'text-muted-foreground',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            {ribbonTab === 'Home' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn
                    icon={<Bold className="size-3.5" />}
                    label="Bold"
                    active={!!active?.bold}
                    onClick={() => toggleFmt('bold')}
                  />
                  <RibbonBtn
                    icon={<Italic className="size-3.5" />}
                    label="Italic"
                    active={!!active?.italic}
                    onClick={() => toggleFmt('italic')}
                  />
                  <RibbonBtn
                    icon={<Underline className="size-3.5" />}
                    label="Underline"
                    active={!!active?.underline}
                    onClick={() => toggleFmt('underline')}
                  />
                </div>
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn
                    icon={<AArrowDown className="size-4" />}
                    label="Decrease font size"
                    onClick={() => changeFontScale(-0.1)}
                  />
                  <span
                    className="min-w-[36px] text-center text-[11px] tabular-nums text-muted-foreground"
                    title="Font size"
                  >
                    {Math.round((active?.fontScale ?? 1) * 100)}%
                  </span>
                  <RibbonBtn
                    icon={<AArrowUp className="size-4" />}
                    label="Increase font size"
                    onClick={() => changeFontScale(0.1)}
                  />
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <RibbonBtn
                    icon={<Pencil className="size-3.5" />}
                    label="Edit slide"
                    active={rightTab === 'edit'}
                    onClick={() => setRightTab('edit')}
                  />
                  <RibbonBtn
                    icon={<Sparkles className="size-3.5" />}
                    label="AI Coach"
                    active={rightTab === 'coach'}
                    onClick={() => setRightTab('coach')}
                  />
                </div>
              </div>
            )}

            {ribbonTab === 'Insert' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <button
                  type="button"
                  onClick={insertTable}
                  disabled={!active}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
                >
                  <TableIcon className="size-3.5" />
                  Table
                </button>
                <button
                  type="button"
                  onClick={pickImage}
                  disabled={!active || imageBusyId === active?.id}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
                >
                  {imageBusyId === active?.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="size-3.5" />
                  )}
                  Image
                </button>
                {active?.tableJson && (
                  <button
                    type="button"
                    onClick={removeTable}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5"
                  >
                    <Trash2 className="size-3" />
                    Remove table
                  </button>
                )}
              </div>
            )}

            {ribbonTab === 'Design' && (
              <div className="flex items-center gap-2 overflow-x-auto px-3 py-1.5">
                <span className="pr-1 text-[11px] font-medium text-muted-foreground">
                  Templates
                </span>
                {THEME_IDS.map((id) => {
                  const t = DECK_THEMES[id];
                  const activeTheme = themeId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => persistTheme(id)}
                      title={`Apply ${t.label} to the whole deck`}
                      className={cn(
                        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors',
                        activeTheme
                          ? 'border-teal-500/60 bg-teal-500/10 text-teal-700 dark:text-teal-300'
                          : 'border-border/60 hover:bg-foreground/5',
                      )}
                    >
                      <span
                        className="size-3 rounded-sm border border-border/40"
                        style={{ background: t.swatch }}
                      />
                      {t.label}
                      {activeTheme && <CheckCircle2 className="size-3" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Shared hidden picker for Insert > Image (ribbon + Edit panel). */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && active) void uploadImage(active.id, f);
              e.target.value = ''; // let the same file be re-picked later
            }}
          />

          {/* Canvas */}
          <div className="min-h-0 flex-1 overflow-auto p-8">
            {active ? (
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>
                    Slide {activeIndex + 1} of {slides.length}
                  </span>
                  <div className="flex items-center gap-3">
                    {/* Original | Editable — only when this slide has a faithful
                        original (VERBATIM imports). Lets faculty compare the
                        uploaded slide against the editable Vaidix copy. */}
                    {active.sourceImageUrl && (
                      <div className="inline-flex rounded-lg border border-border/60 p-0.5 text-[11px]">
                        {(['original', 'editable'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setViewMode(m)}
                            className={cn(
                              'rounded-md px-2 py-0.5 font-medium capitalize transition-colors',
                              viewMode === m
                                ? 'bg-foreground text-background'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                    {savingId === active.id && (
                      <span className="text-[11.5px] text-muted-foreground">Saving…</span>
                    )}
                  </div>
                </div>

                <div className="overflow-hidden rounded-3xl border border-border/60 bg-white shadow-[0_30px_60px_-30px_oklch(0.45_0.15_165/0.25)] dark:bg-card">
                  {viewMode === 'original' && active.sourceImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={active.sourceImageUrl}
                      alt={active.title}
                      className="block w-full"
                      style={{ aspectRatio: '16 / 9', objectFit: 'contain', background: '#000' }}
                    />
                  ) : (
                    <SlideCanvas
                      slide={active}
                      index={activeIndex}
                      total={slides.length}
                      deckTitle={deckTitle}
                      themeId={themeId}
                      backgroundHex={backgroundHex}
                    />
                  )}
                </div>

                {active.speakerNotes && (
                  <section className="mt-4 rounded-2xl border border-border/60 bg-background/60 p-4">
                    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Speaker notes
                    </h3>
                    <p className="text-[13px] leading-relaxed text-foreground/85">
                      {active.speakerNotes}
                    </p>
                  </section>
                )}
              </div>
            ) : (
              <div className="grid h-full place-items-center">
                <div className="max-w-md text-center">
                  <div className="mx-auto grid size-14 place-items-center rounded-3xl bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300">
                    <Sparkles className="size-7" />
                  </div>
                  <h3 className="mt-4 text-[18px] font-semibold tracking-tight">No slides</h3>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    Try forging this deck again.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── RIGHT panel — tabbed: Edit / AI Coach ────────────────────── */}
        <aside className="flex h-full min-h-0 flex-col border-l border-border/60 bg-background/30">
          {/* Tabs */}
          <div role="tablist" className="flex items-center gap-0 border-b border-border/60 px-2 pt-2">
            <button
              role="tab"
              type="button"
              aria-selected={rightTab === 'edit'}
              onClick={() => setRightTab('edit')}
              className={cn(
                'relative flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] font-medium transition-colors',
                rightTab === 'edit' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid="tab-edit"
            >
              <Pencil className="size-3" /> Edit
              {rightTab === 'edit' && (
                <span className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-linear-to-r from-teal-500 to-emerald-500" />
              )}
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={rightTab === 'coach'}
              onClick={() => setRightTab('coach')}
              className={cn(
                'relative flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] font-medium transition-colors',
                rightTab === 'coach' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid="tab-coach"
            >
              <Sparkles className="size-3 text-amber-500" /> AI Coach
              {rightTab === 'coach' && (
                <span className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-linear-to-r from-teal-500 to-emerald-500" />
              )}
            </button>
          </div>

          {/* Tab body — BOTH panels stay mounted; we only toggle visibility.
              Unmounting the AI Coach on every tab switch would drop its
              in-memory analysis and re-trigger a full (paid) analyze pass when
              the faculty came back. Keeping it mounted means analyze runs once,
              on demand, and its result is reused for free. */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className={cn('h-full overflow-y-auto p-4', rightTab !== 'edit' && 'hidden')}>
              {active ? (
                <SlideEditPanel
                  key={active.id}
                  slide={active}
                  saving={savingId === active.id}
                  onChange={(patch) => updateLocal(active.id, patch)}
                  onCommit={(patch) => persistSlide(active.id, patch)}
                  imageBusy={imageBusyId === active.id}
                  imageOffline={imageOfflineId === active.id}
                  onGenerateImage={() => generateImage(active.id)}
                  onUploadImage={pickImage}
                  onRemoveImage={() => removeImage(active.id)}
                />
              ) : null}
            </div>
            <div className={cn('h-full', rightTab !== 'coach' && 'hidden')}>
              <DeckAiCoach
                jobId={jobId}
                initialAnalysis={initialAnalysis}
                slides={slides.map((s) => ({ id: s.id, order: s.order }))}
                activeSlideId={active?.id ?? null}
                onFocusSlide={(slideId) => setActiveId(slideId)}
                onSlideCommitted={async (slideId, patch) => {
                  updateLocal(slideId, {
                    title: patch.title,
                    bullets: patch.bullets,
                    speakerNotes: patch.speakerNotes,
                    ...(patch.layout ? { layout: patch.layout as SlideLayout } : {}),
                  });
                  await persistSlide(slideId, {
                    title: patch.title,
                    bullets: patch.bullets,
                    speakerNotes: patch.speakerNotes,
                    ...(patch.layout ? { layout: patch.layout as SlideLayout } : {}),
                  });
                }}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RibbonBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-6 place-items-center rounded transition-colors',
        active
          ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {icon}
    </button>
  );
}

function SlideEditPanel({
  slide,
  saving,
  onChange,
  onCommit,
  imageBusy,
  imageOffline,
  onGenerateImage,
  onUploadImage,
  onRemoveImage,
}: {
  slide: SlideViewModel;
  saving: boolean;
  onChange: (patch: Partial<SlideViewModel>) => void;
  onCommit: (patch: Partial<SlideViewModel>) => void;
  imageBusy: boolean;
  imageOffline: boolean;
  onGenerateImage: () => void;
  onUploadImage: () => void;
  onRemoveImage: () => void;
}) {
  const table = slide.tableJson ?? null;

  // Persist a whole-table change (add/remove row or column). Empties clear it.
  function commitTable(rows: string[][]) {
    const next = rows.length ? { rows } : null;
    onChange({ tableJson: next });
    onCommit({ tableJson: next });
  }
  function setCell(r: number, c: number, value: string) {
    if (!table) return;
    const rows = table.rows.map((row) => row.slice());
    rows[r][c] = value;
    onChange({ tableJson: { rows } }); // local only; commit on blur
  }
  function addRow() {
    if (!table || table.rows.length >= MAX_TABLE_ROWS) return;
    const cols = table.rows[0]?.length ?? 1;
    commitTable([...table.rows.map((r) => r.slice()), Array(cols).fill('')]);
  }
  function addCol() {
    if (!table || (table.rows[0]?.length ?? 0) >= MAX_TABLE_COLS) return;
    commitTable(table.rows.map((r) => [...r, '']));
  }
  function deleteRow(idx: number) {
    if (!table) return;
    commitTable(table.rows.filter((_, i) => i !== idx));
  }
  function deleteCol(idx: number) {
    if (!table) return;
    commitTable(
      table.rows.map((r) => r.filter((_, i) => i !== idx)).filter((r) => r.length > 0),
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <header className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Edit slide {slide.order + 1}
        </h3>
        {saving && <p className="text-[11px] text-muted-foreground">Saving…</p>}
      </header>

      <label className="block space-y-1">
        <span className="text-[11.5px] text-muted-foreground">Layout</span>
        <select
          value={slide.layout}
          onChange={(e) => {
            const layout = e.target.value as SlideLayout;
            onChange({ layout });
            onCommit({ layout });
          }}
          className="w-full rounded-xl border border-border/60 bg-background/60 px-2.5 py-2 text-[13px] outline-none focus:border-teal-500/50"
        >
          {LAYOUT_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-[11.5px] text-muted-foreground">Title</span>
        <textarea
          value={slide.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={() => onCommit({ title: slide.title })}
          className="min-h-15 w-full rounded-xl border border-border/60 bg-background/60 px-2.5 py-2 text-[13px] outline-none focus:border-teal-500/50"
        />
      </label>

      <div className="space-y-1.5">
        <span className="text-[11.5px] text-muted-foreground">Bullets</span>
        <ul className="space-y-1.5">
          {slide.bullets.map((b, i) => (
            <li key={i} className="flex gap-1.5">
              <textarea
                value={b}
                onChange={(e) => {
                  const next = slide.bullets.slice();
                  next[i] = e.target.value;
                  onChange({ bullets: next });
                }}
                onBlur={() => onCommit({ bullets: slide.bullets })}
                className="min-h-10 flex-1 rounded-xl border border-border/60 bg-background/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-teal-500/50"
              />
              <button
                type="button"
                onClick={() => {
                  const next = slide.bullets.filter((_, idx) => idx !== i);
                  onChange({ bullets: next });
                  onCommit({ bullets: next });
                }}
                className="grid size-7 shrink-0 place-items-center self-start rounded-md border border-border/60 bg-background/60 text-[11px] text-muted-foreground hover:bg-foreground/5"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            if (slide.bullets.length >= 8) return;
            const next = [...slide.bullets, 'New bullet'];
            onChange({ bullets: next });
            onCommit({ bullets: next });
          }}
          className="mt-1 rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/5"
        >
          + Add bullet
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-[11.5px] text-muted-foreground">Speaker notes</span>
        <textarea
          value={slide.speakerNotes ?? ''}
          onChange={(e) => onChange({ speakerNotes: e.target.value })}
          onBlur={() => onCommit({ speakerNotes: slide.speakerNotes ?? null })}
          className="min-h-25 w-full rounded-xl border border-border/60 bg-background/60 px-2.5 py-2 text-[12px] outline-none focus:border-teal-500/50"
          placeholder="What you'll say while presenting…"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11.5px] text-muted-foreground">Accent (hex, no #)</span>
        <input
          type="text"
          value={slide.accentHex ?? ''}
          onChange={(e) => onChange({ accentHex: e.target.value || null })}
          onBlur={() => {
            const v = slide.accentHex;
            if (v && !/^[0-9a-fA-F]{6}$/.test(v)) return;
            onCommit({ accentHex: v ?? null });
          }}
          placeholder="e.g. 00d4f0 (default teal)"
          className="w-full rounded-xl border border-border/60 bg-background/60 px-2.5 py-2 text-[12px] outline-none focus:border-teal-500/50"
        />
      </label>

      {/* ── AI image ──────────────────────────────────────────────────── */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <span className="text-[11.5px] text-muted-foreground">Slide image</span>

        {slide.imageUrl && (
          <div className="overflow-hidden rounded-xl border border-border/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.imageUrl}
              alt={slide.title}
              className="aspect-video w-full object-cover"
            />
          </div>
        )}

        <button
          type="button"
          onClick={onGenerateImage}
          disabled={imageBusy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
        >
          {imageBusy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Generating image…
            </>
          ) : (
            <>
              <Sparkles className="size-3.5 text-amber-500" />
              {slide.imageUrl ? 'Regenerate image (AI)' : 'Generate image (AI)'}
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onUploadImage}
          disabled={imageBusy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
        >
          <ImagePlus className="size-3.5" />
          Upload image…
        </button>

        {slide.imageUrl && !imageBusy && (
          <button
            type="button"
            onClick={onRemoveImage}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Trash2 className="size-3" />
            Remove image
          </button>
        )}

        {imageOffline && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
            AI image builder offline — please try again shortly.
          </p>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] text-muted-foreground">Table</span>
          {table && (
            <button
              type="button"
              onClick={() => commitTable([])}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="size-3" />
              Remove
            </button>
          )}
        </div>

        {table ? (
          <>
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full border-collapse">
                <tbody>
                  {table.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="border border-border/40 p-0">
                          <input
                            type="text"
                            value={cell}
                            onChange={(e) => setCell(r, c, e.target.value)}
                            onBlur={() => table && onCommit({ tableJson: { rows: table.rows } })}
                            placeholder={r === 0 ? `Col ${c + 1}` : ''}
                            className={cn(
                              'w-full min-w-20 bg-transparent px-2 py-1.5 text-[12px] outline-none focus:bg-teal-500/5',
                              r === 0 && 'font-semibold',
                            )}
                          />
                        </td>
                      ))}
                      <td className="w-7 text-center align-middle">
                        <button
                          type="button"
                          aria-label={`Delete row ${r + 1}`}
                          onClick={() => deleteRow(r)}
                          className="grid size-6 place-items-center rounded text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-destructive"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    {(table.rows[0] ?? []).map((_, c) => (
                      <td key={c} className="text-center">
                        <button
                          type="button"
                          aria-label={`Delete column ${c + 1}`}
                          onClick={() => deleteCol(c)}
                          className="grid h-6 w-full place-items-center rounded text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-destructive"
                        >
                          ✕
                        </button>
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={addRow}
                disabled={table.rows.length >= MAX_TABLE_ROWS}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/5 disabled:opacity-40"
              >
                <Plus className="size-3" />
                Row
              </button>
              <button
                type="button"
                onClick={addCol}
                disabled={(table.rows[0]?.length ?? 0) >= MAX_TABLE_COLS}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/5 disabled:opacity-40"
              >
                <Plus className="size-3" />
                Column
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => commitTable(newTable().rows)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            <TableIcon className="size-3.5" />
            Add table
          </button>
        )}
      </div>
    </div>
  );
}

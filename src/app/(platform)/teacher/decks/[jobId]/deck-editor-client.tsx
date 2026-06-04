'use client';

// ════════════════════════════════════════════════════════════════════════════
// Deck editor — restyled to match the demo studio workbench. 3-column layout:
// LEFT = source label + slide thumbnails (reorder), CENTER = PowerPoint-style
// ribbon + large slide canvas, RIGHT = tabbed Edit / AI Coach panel.
// Slides persist via PATCH /api/decks/[jobId]/slides/[slideId];
// reorder via POST /api/decks/[jobId]/reorder. All behavior preserved — only
// markup/Tailwind/layout changed.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bold,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Image as ImageIcon,
  Italic,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Underline,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SlideCanvas, type SlideViewModel } from '@/components/decks/slide-canvas';
import { DeckAiCoach } from '@/components/decks/deck-ai-coach';
import { ThemePicker } from '@/components/decks/theme-picker';
import type { DeckAnalysisResult } from '@/server/services/decks/deck-analyze-service';
import type { DeckForgeStatus, SlideLayout } from '@prisma/client';
import { csrfHeaders } from '@/lib/csrf-client';

const LAYOUT_OPTIONS: SlideLayout[] = [
  'TITLE_ONLY',
  'TITLE_BULLETS',
  'TWO_COLUMN',
  'IMAGE_FOCUS',
  'QUOTE',
  'INTERACTION',
  'CLOSING',
];

const RIBBON_TABS = ['Home', 'Insert', 'Draw', 'Design', 'Animations'] as const;
type RibbonTab = (typeof RIBBON_TABS)[number];

interface Props {
  jobId: string;
  deckTitle: string;
  status: DeckForgeStatus;
  sourceLabel: string;
  initialSlides: SlideViewModel[];
  initialAnalysis: DeckAnalysisResult | null;
  initialTheme?: string | null;
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
}: Props) {
  const router = useRouter();
  const [slides, setSlides] = useState<SlideViewModel[]>(initialSlides);
  const [activeId, setActiveId] = useState<string | null>(initialSlides[0]?.id ?? null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Per-slide AI image state: which slide is generating, and which (if any)
  // hit the offline (503) path so the panel can show an inline note.
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const [imageOfflineId, setImageOfflineId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('coach');
  const [themeId, setThemeId] = useState<string>(initialTheme ?? 'deep-space');
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('Home');

  const active = useMemo(
    () => slides.find((s) => s.id === activeId) ?? slides[0] ?? null,
    [slides, activeId],
  );

  const updateLocal = useCallback((id: string, patch: Partial<SlideViewModel>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  async function persistSlide(id: string, body: Partial<SlideViewModel>) {
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

  function move(id: string, delta: -1 | 1) {
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

  const activeIndex = active ? slides.findIndex((s) => s.id === active.id) : -1;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border/60 bg-background/50 px-6 py-3 backdrop-blur">
        <div className="min-w-0">
          <Link
            href="/teacher/documents"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            Back to documents
          </Link>
          <h1 className="mt-1 truncate text-[19px] font-semibold tracking-tight">{deckTitle}</h1>
          <p className="text-[11.5px] text-muted-foreground">
            {sourceLabel} · {slides.length} slides · {status}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ThemePicker value={themeId} onChange={persistTheme} />

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
          <Link
            href={`/teacher/decks/${jobId}/present`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-5 text-[12.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] dark:bg-slate-700"
          >
            <Eye className="size-3.5" />
            Present
          </Link>
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
            {ribbonTab === 'Home' ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn icon={<Bold className="size-3.5" />} label="Bold" />
                  <RibbonBtn icon={<Italic className="size-3.5" />} label="Italic" />
                  <RibbonBtn icon={<Underline className="size-3.5" />} label="Underline" />
                </div>
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn icon={<TypeIcon className="size-3.5" />} label="Font" />
                  <RibbonBtn icon={<ImageIcon className="size-3.5" />} label="Image" />
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
            ) : (
              <div className="flex h-9 items-center px-3 text-[11.5px] text-muted-foreground">
                {ribbonTab} tools coming soon
              </div>
            )}
          </div>

          {/* Canvas */}
          <div className="min-h-0 flex-1 overflow-auto p-8">
            {active ? (
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>
                    Slide {activeIndex + 1} of {slides.length}
                  </span>
                  {savingId === active.id && (
                    <span className="text-[11.5px] text-muted-foreground">Saving…</span>
                  )}
                </div>

                <div className="overflow-hidden rounded-3xl border border-border/60 bg-white shadow-[0_30px_60px_-30px_oklch(0.45_0.15_165/0.25)] dark:bg-card">
                  <SlideCanvas
                    slide={active}
                    index={activeIndex}
                    total={slides.length}
                    deckTitle={deckTitle}
                    themeId={themeId}
                  />
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

          {/* Tab body */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {rightTab === 'edit' ? (
              <div className="h-full overflow-y-auto p-4">
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
                    onRemoveImage={() => removeImage(active.id)}
                  />
                ) : null}
              </div>
            ) : (
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
            )}
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
  onRemoveImage,
}: {
  slide: SlideViewModel;
  saving: boolean;
  onChange: (patch: Partial<SlideViewModel>) => void;
  onCommit: (patch: Partial<SlideViewModel>) => void;
  imageBusy: boolean;
  imageOffline: boolean;
  onGenerateImage: () => void;
  onRemoveImage: () => void;
}) {
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
    </div>
  );
}

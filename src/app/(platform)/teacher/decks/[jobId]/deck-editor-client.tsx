'use client';

// ════════════════════════════════════════════════════════════════════════════
// Deck editor — restyled to match the demo studio workbench. 3-column layout:
// LEFT = source label + slide thumbnails (reorder), CENTER = PowerPoint-style
// ribbon + large slide canvas, RIGHT = tabbed Edit / AI Coach panel.
// Slides persist via PATCH /api/decks/[jobId]/slides/[slideId];
// reorder via POST /api/decks/[jobId]/reorder. All behavior preserved — only
// markup/Tailwind/layout changed.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns3,
  Download,
  ImagePlus,
  Italic,
  Loader2,
  Minus,
  Plus,
  Rows3,
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
import type { SlideRich } from '@/lib/deck-slide-extras';
import { FaithfulSlide } from '@/components/decks/faithful-slide';
import { DeckRightPanel } from '@/components/decks/deck-right-panel';
import { BackgroundPicker } from '@/components/decks/background-picker';
import { DECK_THEMES, THEME_IDS, getDeckTheme } from '@/lib/deck-themes';
import { DECK_FONTS, DEFAULT_FONT_ID, getFontById, googleFontsUrl } from '@/lib/deck-fonts';
import type { DeckAnalysisResult } from '@/server/services/decks/deck-analyze-service';
import { DeckForgeStatus } from '@prisma/client';
import type { SlideLayout } from '@prisma/client';
import { csrfHeaders } from '@/lib/csrf-client';

// PPT-style font sizes mapped to slide fontScale multipliers.
const FONT_SIZE_STEPS = [
  { pt: 10, scale: 0.60 }, { pt: 12, scale: 0.70 }, { pt: 14, scale: 0.80 },
  { pt: 16, scale: 0.90 }, { pt: 18, scale: 1.00 }, { pt: 20, scale: 1.10 },
  { pt: 24, scale: 1.20 }, { pt: 28, scale: 1.30 }, { pt: 32, scale: 1.40 },
  { pt: 36, scale: 1.50 }, { pt: 40, scale: 1.55 }, { pt: 48, scale: 1.60 },
] as const;

function scaleToSize(scale: number): number {
  let best: { pt: number; scale: number } = FONT_SIZE_STEPS[0];
  for (const s of FONT_SIZE_STEPS) {
    if (Math.abs(s.scale - scale) < Math.abs(best.scale - scale)) best = s;
  }
  return best.pt;
}

function newTable(): SlideTable {
  return { rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']] };
}

/**
 * Set the inline-HTML for bullet `idx`, padding/truncating the rich array so it
 * stays index-aligned with the plain `bullets`. Empty HTML clears the entry
 * (the plain text mirror remains authoritative).
 */
function mergeRichBullets(
  rich: SlideRich | null | undefined,
  bullets: string[],
  idx: number,
  html: string,
): SlideRich {
  const arr = (rich?.bullets ?? []).slice();
  while (arr.length < bullets.length) arr.push(null);
  arr[idx] = html || null;
  return { ...(rich ?? {}), bullets: arr.slice(0, bullets.length) };
}

const LAYOUT_OPTIONS: SlideLayout[] = [
  'TITLE_ONLY',
  'TITLE_BULLETS',
  'TITLE_BODY',
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
  /**
   * The id of the source Document this deck was forged from. Enables the
   * "Delete entire PPT" action in the editor (soft-deletes the whole
   * presentation). Undefined for topic-generated decks with no source doc.
   */
  documentId?: string | null;
}

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
  documentId,
}: Props) {
  const router = useRouter();
  const [slides, setSlides] = useState<SlideViewModel[]>(initialSlides);
  const [activeId, setActiveId] = useState<string | null>(initialSlides[0]?.id ?? null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // VERBATIM imports are flattened (read-only background + text overlays). This
  // tracks the one-time "Convert to editable" regeneration into an AI deck.
  const [regenerating, setRegenerating] = useState(false);
  // Per-slide AI image state: which slide is generating, and which (if any)
  // hit the offline (503) path so the panel can show an inline note.
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const [imageOfflineId, setImageOfflineId] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string>(initialTheme ?? 'deep-space');
  const [backgroundHex, setBackgroundHex] = useState<string | null>(initialBackgroundHex ?? null);
  const [fontFamilyId, setFontFamilyId] = useState<string>(DEFAULT_FONT_ID);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const fontPickerRef = useRef<HTMLDivElement>(null);
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('Home');
  // ── Present gating ────────────────────────────────────────────────────────
  // Present is only allowed on a finalized deck with no edits since that
  // finalize: faculty must always Finalize → then Present. `finalized` seeds
  // from the deck status (APPROVED = previously finalized); any mutation flips
  // `dirty` true, which re-locks Present until the next Finalize.
  const [finalized, setFinalized] = useState(status === DeckForgeStatus.APPROVED);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Index of the bullet that should auto-focus after being added (Enter-key flow).
  const [focusBulletIndex, setFocusBulletIndex] = useState<number | undefined>(undefined);

  // Load Google Font whenever the selected font changes
  useEffect(() => {
    const id = `gfont-${fontFamilyId}`
    if (!document.getElementById(id)) {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = googleFontsUrl(fontFamilyId)
      document.head.appendChild(link)
    }
  }, [fontFamilyId])

  // Close font picker on outside click
  useEffect(() => {
    if (!fontPickerOpen) return
    function handler(e: MouseEvent) {
      if (fontPickerRef.current && !fontPickerRef.current.contains(e.target as Node)) {
        setFontPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fontPickerOpen])

  const active = useMemo(
    () => slides.find((s) => s.id === activeId) ?? slides[0] ?? null,
    [slides, activeId],
  );

  // Any persisted change since the last finalize re-locks Present.
  const markDirty = useCallback(() => setDirty(true), []);
  const canPresent = finalized && !dirty;

  // ── Inline (selection) text formatting ────────────────────────────────────
  // PowerPoint-style: Bold/Italic/Underline act on the CURRENT SELECTION inside
  // the focused slide text — not the whole slide. The button's onMouseDown
  // preventDefault keeps the caret/selection in the editable; execCommand then
  // wraps just the selection in <b>/<i>/<u>, and the EditText commits the new
  // inline HTML on blur. A selectionchange listener drives the toggled state.
  const [selFmt, setSelFmt] = useState({ bold: false, italic: false, underline: false });
  useEffect(() => {
    function onSel() {
      try {
        setSelFmt({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
        });
      } catch {
        /* no active selection */
      }
    }
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  function applyInlineFormat(cmd: 'bold' | 'italic' | 'underline') {
    try {
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand(cmd);
    } catch {
      /* execCommand unsupported */
    }
  }

  const updateLocal = useCallback((id: string, patch: Partial<SlideViewModel>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  async function persistSlide(
    id: string,
    body: Partial<SlideViewModel> & { overlayJson?: unknown },
  ) {
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

  function changeFontFamily(id: string) {
    setFontFamilyId(id)
    setFontPickerOpen(false)
    localStorage.setItem(`deck-font:${jobId}`, id)
  }

  // ── Ribbon Insert: table ──────────────────────────────────────────────────
  function insertTable() {
    if (!active) return;
    if (active.tableJson) return; // already has one — it's editable on the slide
    const tableJson = newTable();
    updateLocal(active.id, { tableJson });
    void persistSlide(active.id, { tableJson });
  }

  function removeTable() {
    if (!active) return;
    updateLocal(active.id, { tableJson: null });
    void persistSlide(active.id, { tableJson: null });
  }

  // Persist a structural/colour change to the active slide's table. Always sent
  // as a full table (rows + headerHex) so partial edits keep the other field.
  function updateTable(next: SlideTable) {
    if (!active) return;
    updateLocal(active.id, { tableJson: next });
    void persistSlide(active.id, { tableJson: next });
  }

  function addTableRow() {
    if (!active?.tableJson) return;
    const cols = active.tableJson.rows[0]?.length ?? 1;
    const rows = [...active.tableJson.rows.map((r) => r.slice()), Array(cols).fill('')];
    if (rows.length > 12) return; // matches API bound
    updateTable({ ...active.tableJson, rows });
  }

  function deleteTableRow() {
    if (!active?.tableJson) return;
    if (active.tableJson.rows.length <= 2) return; // keep header + ≥1 body row
    const rows = active.tableJson.rows.slice(0, -1).map((r) => r.slice());
    updateTable({ ...active.tableJson, rows });
  }

  function addTableColumn() {
    if (!active?.tableJson) return;
    const cols = active.tableJson.rows[0]?.length ?? 0;
    if (cols >= 8) return; // matches API bound
    const rows = active.tableJson.rows.map((r, i) => [...r, i === 0 ? `Column ${cols + 1}` : '']);
    updateTable({ ...active.tableJson, rows });
  }

  function deleteTableColumn() {
    if (!active?.tableJson) return;
    const cols = active.tableJson.rows[0]?.length ?? 0;
    if (cols <= 1) return;
    const rows = active.tableJson.rows.map((r) => r.slice(0, -1));
    updateTable({ ...active.tableJson, rows });
  }

  function setTableHeaderHex(hex: string | null) {
    if (!active?.tableJson) return;
    updateTable({ ...active.tableJson, headerHex: hex });
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

  // Delete the ENTIRE presentation (soft-delete the source document). Removes
  // the whole PPT — its slides and faithful originals — from the session, then
  // returns to the studio (or documents) where it no longer appears.
  async function deleteDeck() {
    if (!documentId) {
      // Topic-only deck with no source doc: discard the deck job instead.
      if (!window.confirm('Delete this presentation? This cannot be undone here.')) return;
      setDeleting(true);
      setError(null);
      try {
        const res = await fetch(`/api/decks/${jobId}`, { method: 'DELETE', headers: { ...csrfHeaders() } });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
        router.push(backToSessionId ? `/session/${backToSessionId}/studio` : '/teacher/documents');
      } catch (err) {
        setError((err as Error).message);
        setDeleting(false);
      }
      return;
    }
    if (!window.confirm(`Delete the entire presentation “${deckTitle}”? It is removed from this session and your documents. This can’t be undone here.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Delete failed (${res.status})`);
      }
      router.push(backToSessionId ? `/session/${backToSessionId}/studio` : '/teacher/documents');
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  // Convert a VERBATIM (flattened) import into a fully-editable AI deck. The
  // original slides are images with text overlays — you can't add/remove tables,
  // images, text boxes, or the background on them. This re-authors the deck from
  // its source so every element becomes an editable object. Destructive: it
  // replaces the current slides, so we confirm first and hard-reload on success
  // to re-seed the editor with the new editable slides.
  async function regenerateEditable() {
    if (regenerating) return;
    if (
      !window.confirm(
        'Convert this presentation into a fully editable deck?\n\n' +
          'It was imported as-is, so its slides are fixed images you can only ' +
          'edit text on. Converting re-creates every slide as editable text, ' +
          'bullets, tables and images — but replaces the current fixed slides ' +
          '(any manual tweaks to them are lost). This can take a moment.',
      )
    )
      return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/regenerate`, {
        method: 'POST',
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        const msg =
          res.status === 503
            ? 'The AI deck builder is temporarily unavailable. Please try again shortly.'
            : (j?.error?.message ?? `Convert failed (${res.status})`);
        throw new Error(msg);
      }
      // Reload so the page loader re-presigns the new editable slides and the
      // editor renders the editable canvas instead of the faithful original.
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setRegenerating(false);
    }
  }

  const activeIndex = active ? slides.findIndex((s) => s.id === active.id) : -1;
  const isVerbatim = importMode === 'VERBATIM';

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <header className="relative z-20 flex items-center justify-between border-b border-border/60 bg-background/50 px-6 py-3 backdrop-blur">
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
          {/* Delete the entire presentation (the whole PPT, not a slide). */}
          <button
            type="button"
            onClick={deleteDeck}
            disabled={deleting}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rose-300/60 bg-rose-50 px-4 text-[12.5px] font-medium text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-400"
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {deleting ? 'Deleting…' : 'Delete PPT'}
          </button>
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
                        data-slide-index={i}
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
                            {/* For a faithful import, the thumbnail shows the
                                rasterised ORIGINAL so the rail matches the
                                slide you see in the canvas. AI/topic decks (no
                                source image) keep the live Vaidix render. */}
                            {s.sourceImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={s.sourceImageUrl}
                                alt={s.title}
                                className="block w-full"
                                style={{ aspectRatio: '16 / 9', objectFit: 'contain', background: '#fff' }}
                              />
                            ) : (
                              <SlideCanvas
                                slide={s}
                                index={i}
                                total={slides.length}
                                deckTitle={deckTitle}
                                themeId={themeId}
                                backgroundHex={backgroundHex}
                                fontFamily={getFontById(fontFamilyId).family}
                              />
                            )}
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
                {/* Font family picker — applies to all slides */}
                <div className="relative border-r border-border/60 pr-3" ref={fontPickerRef}>
                  <button
                    type="button"
                    onClick={() => setFontPickerOpen((v) => !v)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[12px] font-medium hover:bg-foreground/5"
                    style={{ fontFamily: getFontById(fontFamilyId).family }}
                  >
                    {getFontById(fontFamilyId).label}
                    <ChevronDown className={cn('size-3 text-muted-foreground transition-transform', fontPickerOpen && 'rotate-180')} />
                  </button>
                  {fontPickerOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/10">
                      <div className="max-h-72 overflow-y-auto p-1">
                        {DECK_FONTS.map((font) => (
                          <button
                            key={font.id}
                            type="button"
                            onClick={() => changeFontFamily(font.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-muted/60',
                              font.id === fontFamilyId && 'bg-teal-500/10 text-teal-700',
                            )}
                            style={{ fontFamily: font.family }}
                          >
                            {font.label}
                            {font.id === fontFamilyId && <CheckCircle2 className="ml-auto size-3.5 text-teal-500" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span className="pr-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">Selection</span>
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn
                    icon={<Bold className="size-3.5" />}
                    label="Bold (selected text)"
                    active={selFmt.bold}
                    onMouseDown={(e) => { e.preventDefault(); applyInlineFormat('bold'); }}
                  />
                  <RibbonBtn
                    icon={<Italic className="size-3.5" />}
                    label="Italic (selected text)"
                    active={selFmt.italic}
                    onMouseDown={(e) => { e.preventDefault(); applyInlineFormat('italic'); }}
                  />
                  <RibbonBtn
                    icon={<Underline className="size-3.5" />}
                    label="Underline (selected text)"
                    active={selFmt.underline}
                    onMouseDown={(e) => { e.preventDefault(); applyInlineFormat('underline'); }}
                  />
                </div>
                {/* Font size — PPT-style pt sizes mapped to slide fontScale */}
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <select
                    value={scaleToSize(active?.fontScale ?? 1.0)}
                    onChange={(e) => {
                      if (!active) return
                      const pt = parseInt(e.target.value, 10)
                      const next = FONT_SIZE_STEPS.find((s) => s.pt === pt)?.scale ?? 1.0
                      updateLocal(active.id, { fontScale: next })
                      void persistSlide(active.id, { fontScale: next })
                    }}
                    className="h-7 w-14 rounded-md border border-border/60 bg-background/60 px-1.5 text-[12px] outline-none focus:border-teal-500/50"
                    title="Font size"
                  >
                    {FONT_SIZE_STEPS.map(({ pt }) => (
                      <option key={pt} value={pt}>{pt}</option>
                    ))}
                  </select>
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
                <button
                  type="button"
                  onClick={() => active && generateImage(active.id)}
                  disabled={!active || imageBusyId === active?.id}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
                >
                  {imageBusyId === active?.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5 text-amber-500" />
                  )}
                  {active?.imageUrl ? 'Regenerate (AI)' : 'Generate image (AI)'}
                </button>
                {imageOfflineId === active?.id && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
                    AI image builder offline — try again shortly.
                  </span>
                )}
                {active?.tableJson && (
                  <>
                    <span className="h-5 w-px shrink-0 bg-border/60" />
                    <div className="inline-flex items-center overflow-hidden rounded-md border border-border/60 bg-background/60">
                      <button
                        type="button"
                        onClick={addTableRow}
                        title="Add row"
                        className="inline-flex h-7 items-center gap-1 px-2 text-[11.5px] font-medium hover:bg-foreground/5"
                      >
                        <Plus className="size-3" />
                        <Rows3 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={deleteTableRow}
                        title="Delete last row"
                        disabled={(active.tableJson.rows.length ?? 0) <= 2}
                        className="inline-flex h-7 items-center gap-1 border-l border-border/60 px-2 text-[11.5px] font-medium hover:bg-foreground/5 disabled:opacity-40"
                      >
                        <Minus className="size-3" />
                        <Rows3 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={addTableColumn}
                        title="Add column"
                        disabled={(active.tableJson.rows[0]?.length ?? 0) >= 8}
                        className="inline-flex h-7 items-center gap-1 border-l border-border/60 px-2 text-[11.5px] font-medium hover:bg-foreground/5 disabled:opacity-40"
                      >
                        <Plus className="size-3" />
                        <Columns3 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={deleteTableColumn}
                        title="Delete last column"
                        disabled={(active.tableJson.rows[0]?.length ?? 0) <= 1}
                        className="inline-flex h-7 items-center gap-1 border-l border-border/60 px-2 text-[11.5px] font-medium hover:bg-foreground/5 disabled:opacity-40"
                      >
                        <Minus className="size-3" />
                        <Columns3 className="size-3.5" />
                      </button>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Header</span>
                    <BackgroundPicker
                      value={active.tableJson.headerHex ?? null}
                      themeDefault={getDeckTheme(themeId).panel}
                      onChange={(hex) => setTableHeaderHex(hex)}
                      onReset={() => setTableHeaderHex(null)}
                    />
                    <button
                      type="button"
                      onClick={removeTable}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5"
                    >
                      <Trash2 className="size-3" />
                      Remove table
                    </button>
                  </>
                )}
                {active?.imageUrl && (
                  <button
                    type="button"
                    onClick={() => active && removeImage(active.id)}
                    disabled={imageBusyId === active?.id}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-[11.5px] font-medium text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-40 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-400"
                  >
                    <Trash2 className="size-3" />
                    Remove image
                  </button>
                )}
              </div>
            )}

            {ribbonTab === 'Design' && (
              <div className="flex items-center gap-3 overflow-x-auto px-3 py-1.5">
                {/* Per-slide layout — replaces the old right-panel Layout dropdown */}
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Layout</span>
                <select
                  value={active?.layout ?? 'TITLE_BULLETS'}
                  disabled={!active}
                  onChange={(e) => {
                    if (!active) return;
                    const layout = e.target.value as SlideLayout;
                    updateLocal(active.id, { layout });
                    void persistSlide(active.id, { layout });
                  }}
                  className="h-7 shrink-0 rounded-md border border-border/60 bg-background/60 px-2 text-[11.5px] outline-none focus:border-teal-500/50 disabled:opacity-40"
                  title="Slide layout"
                >
                  {LAYOUT_OPTIONS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <span className="h-5 w-px shrink-0 bg-border/60" />
                {/* Per-slide accent colour — replaces the old right-panel Accent field */}
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Accent</span>
                <BackgroundPicker
                  value={active?.accentHex ?? null}
                  themeDefault={getDeckTheme(themeId).primary}
                  onChange={(hex) => {
                    if (!active) return;
                    updateLocal(active.id, { accentHex: hex });
                    void persistSlide(active.id, { accentHex: hex });
                  }}
                  onReset={() => {
                    if (!active) return;
                    updateLocal(active.id, { accentHex: null });
                    void persistSlide(active.id, { accentHex: null });
                  }}
                />
                <span className="h-5 w-px shrink-0 bg-border/60" />
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Theme</span>
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
                <span className="h-5 w-px shrink-0 bg-border/60" />
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Colour</span>
                <BackgroundPicker
                  value={backgroundHex}
                  themeDefault={getDeckTheme(themeId).bg}
                  onChange={persistBackground}
                  onReset={() => persistBackground(null)}
                />
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
            {/* VERBATIM imports are flattened images + text overlays — tables,
                images, text boxes and the background can't be added or deleted.
                Offer a one-time conversion into a fully-editable AI deck. */}
            {isVerbatim && (
              <div className="mx-auto mb-4 flex max-w-3xl flex-col gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                <div className="min-w-0 text-[12px] leading-snug">
                  <p className="font-medium">This deck was imported as-is (fixed slides).</p>
                  <p className="text-amber-800/90 dark:text-amber-200/80">
                    You can only edit text on these slides — tables, images, text boxes and the
                    background are part of the original picture and can’t be added or removed.
                    Convert it to edit everything.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={regenerateEditable}
                  disabled={regenerating}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                >
                  {regenerating ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Converting…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                      Convert to editable
                    </>
                  )}
                </button>
              </div>
            )}
            {active ? (
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>
                    Slide {activeIndex + 1} of {slides.length}
                  </span>
                  <div className="flex items-center gap-3">
                    {active.sourceImageUrl && active.overlay && (
                      <span className="text-[11px] text-muted-foreground">Click any text to edit — your slide stays as-is</span>
                    )}
                    {savingId === active.id && (
                      <span className="text-[11.5px] text-muted-foreground">Saving…</span>
                    )}
                  </div>
                </div>

                <div className="overflow-hidden rounded-3xl border border-border/60 bg-white shadow-[0_30px_60px_-30px_oklch(0.45_0.15_165/0.25)] dark:bg-card">
                  {active.sourceImageUrl && active.overlay ? (
                    // Faithful import: edit IN PLACE on the original image.
                    <FaithfulSlide
                      imageUrl={active.sourceImageUrl}
                      overlay={active.overlay}
                      editable
                      onBoxChange={(slotId, text) => {
                        const cur = active.overlay;
                        if (!cur) return;
                        const overlay = {
                          boxes: cur.boxes.map((b) => (b.slotId === slotId ? { ...b, text } : b)),
                        };
                        updateLocal(active.id, { overlay });
                        void persistSlide(active.id, { overlayJson: overlay });
                      }}
                    />
                  ) : active.sourceImageUrl ? (
                    // Faithful original with no editable overlay (e.g. a PDF
                    // import): show it as-is, view-only.
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
                      fontFamily={getFontById(fontFamilyId).family}
                      editable
                      focusBulletIndex={focusBulletIndex}
                      onTitleChange={(plain, html) => {
                        const richJson: SlideRich = { ...(active.richJson ?? {}), title: html || null }
                        updateLocal(active.id, { title: plain, richJson })
                        void persistSlide(active.id, { title: plain, richJson })
                      }}
                      onBulletChange={(idx, plain, html) => {
                        setFocusBulletIndex(undefined)
                        const next = active.bullets.slice()
                        next[idx] = plain
                        const richJson = mergeRichBullets(active.richJson, next, idx, html)
                        updateLocal(active.id, { bullets: next, richJson })
                        void persistSlide(active.id, { bullets: next, richJson })
                      }}
                      onCommitNewBullet={(plain, html) => {
                        const next = [...active.bullets, plain]
                        const richJson = mergeRichBullets(active.richJson, next, next.length - 1, html)
                        const layoutPatch = active.layout === 'TITLE_ONLY' ? { layout: 'TITLE_BULLETS' as const } : {}
                        updateLocal(active.id, { bullets: next, richJson, ...layoutPatch })
                        void persistSlide(active.id, { bullets: next, richJson, ...layoutPatch })
                      }}
                      onAddBullet={() => {
                        // Called by Enter key on existing bullet — adds empty bullet and auto-focuses it.
                        const next = [...active.bullets, '']
                        const layoutPatch = active.layout === 'TITLE_ONLY' ? { layout: 'TITLE_BULLETS' as const } : {}
                        const newIdx = next.length - 1
                        updateLocal(active.id, { bullets: next, ...layoutPatch })
                        void persistSlide(active.id, { bullets: next, ...layoutPatch })
                        setFocusBulletIndex(newIdx)
                      }}
                      onDeleteBullet={(idx) => {
                        const next = active.bullets.filter((_, i) => i !== idx)
                        const richBullets = (active.richJson?.bullets ?? []).filter((_, i) => i !== idx)
                        const richJson: SlideRich = { ...(active.richJson ?? {}), bullets: richBullets }
                        updateLocal(active.id, { bullets: next, richJson })
                        void persistSlide(active.id, { bullets: next, richJson })
                        setFocusBulletIndex(Math.max(0, idx - 1))
                      }}
                      onTableChange={(rows) => {
                        const tableJson = { ...(active.tableJson ?? {}), rows }
                        updateLocal(active.id, { tableJson })
                        void persistSlide(active.id, { tableJson })
                      }}
                      onImageBoxChange={(box) => {
                        updateLocal(active.id, { imageBox: box })
                        void persistSlide(active.id, { imageBox: box })
                      }}
                      onTableMeta={(meta) => {
                        if (!active.tableJson) return
                        const tableJson = { ...active.tableJson, ...meta }
                        updateLocal(active.id, { tableJson })
                        void persistSlide(active.id, { tableJson })
                      }}
                    />
                  )}
                </div>

                {/* Speaker notes — editable strip under the slide (PowerPoint-style) */}
                <section className="mt-4 rounded-2xl border border-border/60 bg-background/60 p-4">
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Speaker notes
                  </h3>
                  <textarea
                    key={active.id}
                    defaultValue={active.speakerNotes ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null
                      if (v !== (active.speakerNotes ?? null)) {
                        updateLocal(active.id, { speakerNotes: v })
                        void persistSlide(active.id, { speakerNotes: v })
                      }
                    }}
                    placeholder="What you'll say while presenting this slide…"
                    className="min-h-20 w-full resize-y rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-[13px] leading-relaxed text-foreground/85 outline-none focus:border-teal-500/50"
                  />
                </section>
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

        {/* ── RIGHT panel — tabbed AI surface ──────────────────────────────
            The slide itself is the editor (click any text to edit in place;
            layout/accent/theme/table/image controls live in the ribbon). The
            right panel carries the AI tooling: Analysis, Fixes, AI Slides and
            Hooks. Hooks is functional only in the session-studio context. */}
        <aside className="flex h-full min-h-0 flex-col border-l border-border/60 bg-background/30">
          <DeckRightPanel
            jobId={jobId}
            initialAnalysis={initialAnalysis}
            slides={slides.map((s) => ({ id: s.id, order: s.order }))}
            activeSlideId={active?.id ?? null}
            activeSlideOrder={active?.order ?? null}
            sessionId={backToSessionId ?? null}
            onFocusSlide={(slideId) => setActiveId(slideId)}
            onSlidesAppended={(newSlides) => {
              setSlides((prev) => [...prev, ...newSlides]);
              if (newSlides[0]) setActiveId(newSlides[0].id);
              markDirty();
            }}
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
  onMouseDown,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  /** Used by formatting buttons: preventDefault here keeps the editor selection. */
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      onMouseDown={onMouseDown}
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

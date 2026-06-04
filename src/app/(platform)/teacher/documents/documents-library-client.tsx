'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DocumentRoute, DeckForgeStatus } from '@prisma/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle, ArrowLeft, CheckCircle2, Clock, File, FileText, Film,
  FolderOpen, HardDrive, LayoutGrid, List, Loader2, Play, Plus,
  RotateCw, Search, Sparkles, Upload, User, X,
} from 'lucide-react';
import { csrfHeaders } from '@/lib/csrf-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  title: string;
  kind: string;
  route: DocumentRoute;
  status: string;
  visibility: string;
  uploaderName: string;
  sizeBytes: number;
  createdAt: string;
  /** Latest non-FAILED, non-REJECTED forge job for this doc. Null if never forged. */
  latestForgeJobId: string | null;
  latestForgeStatus: DeckForgeStatus | null;
  latestForgeSlideCount: number | null;
}

type RouteFilter = 'ALL' | DocumentRoute;

const FORGE_IN_PROGRESS: DeckForgeStatus[] = [
  'QUEUED',
  'EXTRACTING',
  'GENERATING_SLIDES',
];
const FORGE_TERMINAL_SUCCESS: DeckForgeStatus[] = ['REVIEW_PENDING', 'APPROVED'];

function classifyForge(status: DeckForgeStatus | null): 'none' | 'in_progress' | 'ready' {
  if (!status) return 'none';
  if (FORGE_IN_PROGRESS.includes(status)) return 'in_progress';
  if (FORGE_TERMINAL_SUCCESS.includes(status)) return 'ready';
  return 'none';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTE_LABEL: Record<DocumentRoute, string> = {
  DECK_FORGE: 'Deck Forge',
  REFERENCE: 'Reference',
  CASE_NOTE: 'Case notes',
  PROMO_ASSET: 'Promo asset',
  PROMO_TEASER_VIDEO: 'Promo video',
  UNCLASSIFIED: 'Unclassified',
};

const ROUTE_BADGE: Record<DocumentRoute, string> = {
  DECK_FORGE: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  REFERENCE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  CASE_NOTE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  PROMO_ASSET: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  PROMO_TEASER_VIDEO: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  UNCLASSIFIED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const FILTER_OPTIONS: { value: RouteFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'DECK_FORGE', label: 'Deck Forge' },
  { value: 'REFERENCE', label: 'Reference' },
  { value: 'CASE_NOTE', label: 'Case notes' },
  { value: 'PROMO_ASSET', label: 'Promo asset' },
  { value: 'UNCLASSIFIED', label: 'Unclassified' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getFileConfig(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes('pdf'))
    return { label: 'PDF', bar: 'from-rose-500 to-pink-600', icon: FileText, iconCls: 'text-rose-500', bgCls: 'bg-rose-50 dark:bg-rose-950/30' };
  if (k.includes('presentation') || k.includes('powerpoint'))
    return { label: 'PPT', bar: 'from-orange-500 to-amber-500', icon: FileText, iconCls: 'text-orange-500', bgCls: 'bg-orange-50 dark:bg-orange-950/30' };
  if (k.includes('word') || k.includes('document') || k.includes('msword') || k.includes('docx'))
    return { label: 'DOC', bar: 'from-blue-500 to-indigo-500', icon: FileText, iconCls: 'text-blue-500', bgCls: 'bg-blue-50 dark:bg-blue-950/30' };
  if (k.includes('video') || k.includes('mp4') || k.includes('mov'))
    return { label: 'Video', bar: 'from-violet-500 to-purple-600', icon: Film, iconCls: 'text-violet-500', bgCls: 'bg-violet-50 dark:bg-violet-950/30' };
  if (k.includes('image') || k.includes('png') || k.includes('jpg') || k.includes('jpeg'))
    return { label: 'Image', bar: 'from-cyan-500 to-teal-500', icon: File, iconCls: 'text-cyan-500', bgCls: 'bg-cyan-50 dark:bg-cyan-950/30' };
  if (k.includes('text') || k.includes('markdown') || k.includes('plain'))
    return { label: 'Text', bar: 'from-emerald-500 to-green-500', icon: FileText, iconCls: 'text-emerald-500', bgCls: 'bg-emerald-50 dark:bg-emerald-950/30' };
  return { label: 'File', bar: 'from-slate-400 to-slate-500', icon: File, iconCls: 'text-slate-500', bgCls: 'bg-slate-50 dark:bg-slate-950/20' };
}

// ─── Animation variants ───────────────────────────────────────────────────────

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

// `ease` typed as a Bezier tuple — framer-motion v11 narrowed Variants so a
// plain `number[]` literal no longer satisfies the Easing | Easing[] union.
// `as const` keeps the array a fixed-length 4-tuple at the type level.
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const } },
};

// ─── Upload Modal ─────────────────────────────────────────────────────────────

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function UploadModal({ open, onClose, onSuccess }: UploadModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'classifying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = phase === 'uploading' || phase === 'classifying';

  function reset() {
    setTitle(''); setDescription(''); setFile(null);
    setPhase('idle'); setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  function pickFile(f: File) {
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) pickFile(dropped);
  }

  async function handleSubmit() {
    if (!file || !title.trim()) { setError('Title and file are required'); return; }
    setError(null);
    setPhase('uploading');
    try {
      const body = new FormData();
      body.append('title', title.trim());
      body.append('description', description.trim());
      body.append('file', file);

      const res = await fetch('/api/documents/upload', { method: 'POST', body });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { document: { id: string } };
        error?: { message: string };
      };
      if (!json.ok || !json.data) throw new Error(json.error?.message ?? `Upload failed (${res.status})`);

      setPhase('classifying');
      void fetch(`/api/documents/${json.data.document.id}/classify`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 700));

      setPhase('done');
      toast.success(`"${title}" added to your library`);
      await new Promise(r => setTimeout(r, 600));
      onSuccess();
      handleClose();
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-lg overflow-hidden rounded-3xl border border-border/80 bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                  <Upload className="size-4 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Add to library</p>
                  <p className="text-[11px] text-muted-foreground">PDF · PPT · DOC · Image · Video — max 500 MB</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={busy}
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              {/* Drop zone */}
              <motion.div
                animate={dragOver ? { scale: 1.02 } : { scale: 1 }}
                transition={{ duration: 0.15 }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !busy && fileInputRef.current?.click()}
                className={`relative cursor-pointer select-none rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : file
                    ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20'
                    : 'border-border/60 hover:border-primary/50 hover:bg-muted/20'
                } ${busy ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  accept=".ppt,.pptx,.pdf,.doc,.docx,.md,.png,.jpg,.jpeg,.mp4,.mov"
                  onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
                />
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="size-9 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(file.size)} · click to replace</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2.5">
                    <div className={`flex size-12 items-center justify-center rounded-2xl transition-colors ${dragOver ? 'bg-primary/20' : 'bg-muted'}`}>
                      <Upload className={`size-5 transition-colors ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Drop your file here, or click to browse</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Supports PDF, PPT, DOC, images, and video</p>
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Title */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground uppercase tracking-wide">Title *</label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Macular Edema Classification Atlas"
                  disabled={busy}
                  maxLength={200}
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Description <span className="font-normal normal-case opacity-60">(optional)</span>
                </label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What should students know before opening this?"
                  rows={2}
                  disabled={busy}
                  maxLength={500}
                />
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
                  >
                    <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Phase progress */}
              <AnimatePresence>
                {phase !== 'idle' && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold ${
                      phase === 'done'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'bg-primary/5 text-primary'
                    }`}
                  >
                    {phase === 'done' ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    {phase === 'uploading' && 'Uploading file…'}
                    {phase === 'classifying' && 'AI classifying document…'}
                    {phase === 'done' && 'Added to library!'}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/20 px-6 py-4">
              <Button variant="outline" onClick={handleClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={phase !== 'idle' || !file || !title.trim()}
                className="gap-2"
              >
                {phase === 'idle' ? (
                  <><Upload className="size-3.5" /> Upload + AI classify</>
                ) : (
                  <><Loader2 className="size-3.5 animate-spin" /> Working…</>
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Doc Card (grid view) ─────────────────────────────────────────────────────

interface DocActionProps {
  doc: DocumentRow;
  classifying: string | null;
  forging: string | null;
  onApprove: (id: string, route: DocumentRoute) => void;
  onForge: (id: string, opts?: { force?: boolean }) => void;
  canForge?: boolean;
  linkingSessionId?: string | null;
  linked?: boolean;
  linkingBusy?: boolean;
  onLink?: (id: string) => void;
}

function DocCard({ doc, classifying, forging, onApprove, onForge, canForge = true, linkingSessionId, linked, linkingBusy, onLink }: DocActionProps) {
  const cfg = getFileConfig(doc.kind);
  const Icon = cfg.icon;

  // ── Linking mode: clean selection card ──
  if (linkingSessionId) {
    return (
      <motion.div
        variants={itemVariants}
        whileHover={!linked && !linkingBusy ? { y: -2, transition: { duration: 0.15 } } : {}}
        onClick={() => !linked && !linkingBusy && onLink?.(doc.id)}
        className={`group relative flex flex-col overflow-hidden rounded-2xl border-2 transition-all duration-200 ${
          linked
            ? 'cursor-default border-emerald-500 bg-emerald-50/20 shadow-sm dark:bg-emerald-950/10'
            : 'cursor-pointer border-border/60 bg-card hover:border-teal-400/70 hover:shadow-md'
        }`}
      >
        {/* Color bar */}
        <div className={`h-1 w-full bg-linear-to-r ${linked ? 'from-emerald-400 to-green-500' : cfg.bar}`} />

        {/* Checkbox indicator */}
        <div className="absolute right-3 top-4 z-10">
          <div className={`flex size-6 items-center justify-center rounded-full border-2 transition-all ${
            linked
              ? 'border-emerald-500 bg-emerald-500'
              : 'border-border/60 bg-white/90 group-hover:border-teal-400 dark:bg-card'
          }`}>
            {linkingBusy
              ? <Loader2 className="size-3 animate-spin text-teal-600" />
              : linked
              ? <CheckCircle2 className="size-3.5 text-white" />
              : null}
          </div>
        </div>

        {/* Icon + type */}
        <div className={`flex items-center gap-2 px-4 py-2.5 ${cfg.bgCls}`}>
          <Icon className={`size-4 shrink-0 ${cfg.iconCls}`} />
          <span className="text-[10px] font-bold text-muted-foreground">{cfg.label}</span>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-2 p-4 pr-10">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{doc.title}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><User className="size-3" />{doc.uploaderName}</span>
            <span className="flex items-center gap-1"><Clock className="size-3" />{formatRelativeTime(doc.createdAt)}</span>
            <span className="flex items-center gap-1"><HardDrive className="size-3" />{formatSize(doc.sizeBytes)}</span>
          </div>
          <span className={`w-fit rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${ROUTE_BADGE[doc.route]}`}>
            {ROUTE_LABEL[doc.route]}
          </span>
        </div>

        {/* Bottom action bar */}
        <div className={`border-t px-4 py-2.5 text-center text-[11px] font-semibold transition-colors ${
          linked
            ? 'border-emerald-200/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : linkingBusy
            ? 'border-border/40 bg-teal-50/60 text-teal-600'
            : 'border-border/40 text-teal-700 group-hover:bg-teal-50/60 dark:text-teal-400'
        }`}>
          {linkingBusy ? (
            <span className="flex items-center justify-center gap-1.5"><Loader2 className="size-3 animate-spin" /> Adding…</span>
          ) : linked ? (
            <span className="flex items-center justify-center gap-1.5"><CheckCircle2 className="size-3.5" /> Added to pack</span>
          ) : (
            <span className="flex items-center justify-center gap-1.5"><Plus className="size-3.5" /> Add to session pack</span>
          )}
        </div>
      </motion.div>
    );
  }

  // ── Normal mode ──
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-shadow duration-200 hover:shadow-lg"
    >
      {/* Color bar by file type */}
      <div className={`h-0.75 w-full bg-linear-to-r ${cfg.bar}`} />

      {/* Icon area */}
      <div className={`flex items-center gap-2 px-4 py-3 ${cfg.bgCls}`}>
        <Icon className={`size-4 shrink-0 ${cfg.iconCls}`} />
        <span className="text-[10px] font-bold text-muted-foreground">{cfg.label}</span>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Link
          href={`/teacher/documents/${doc.id}`}
          className="line-clamp-2 text-sm font-semibold leading-snug hover:text-primary transition-colors"
        >
          {doc.title}
        </Link>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><User className="size-3" />{doc.uploaderName}</span>
          <span className="flex items-center gap-1"><Clock className="size-3" />{formatRelativeTime(doc.createdAt)}</span>
          <span className="flex items-center gap-1"><HardDrive className="size-3" />{formatSize(doc.sizeBytes)}</span>
        </div>

        <span className={`w-fit rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${ROUTE_BADGE[doc.route]}`}>
          {ROUTE_LABEL[doc.route]}
        </span>

        {/* Reclassify pills — faculty-only AI action */}
        {canForge && (
          <div className="flex flex-wrap gap-1 border-t border-border/40 pt-2.5">
            {(['DECK_FORGE', 'REFERENCE', 'CASE_NOTE'] as DocumentRoute[]).map(r => (
              <button
                key={r}
                type="button"
                disabled={classifying === doc.id || doc.route === r}
                onClick={() => onApprove(doc.id, r)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  doc.route === r
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:bg-muted/60'
                } disabled:opacity-40`}
              >
                {ROUTE_LABEL[r]}
              </button>
            ))}
          </div>
        )}

        {canForge && <ForgeAction doc={doc} forging={forging} onForge={onForge} variant="card" />}
      </div>
    </motion.div>
  );
}

// ─── Forge action (state-aware) ───────────────────────────────────────────────
//
// Renders one of four states based on the document's latest forge job:
//   - ready (REVIEW_PENDING / APPROVED) → "View slides" primary + "Re-forge"
//   - in_progress (QUEUED / EXTRACTING / GENERATING_SLIDES) → "Forging…" link
//   - none → "Forge slides" button
//   - failed jobs are filtered out by the service so they look like "none" here

interface ForgeActionProps {
  doc: DocumentRow;
  forging: string | null;
  onForge: (id: string, opts?: { force?: boolean }) => void;
  variant: 'card' | 'row';
}

function ForgeAction({ doc, forging, onForge, variant }: ForgeActionProps) {
  const state = classifyForge(doc.latestForgeStatus);
  const isBusy = forging === doc.id;

  if (state === 'ready' && doc.latestForgeJobId) {
    if (variant === 'card') {
      return (
        <div className="mt-auto flex flex-col gap-1.5">
          <Link
            href={`/teacher/decks/${doc.latestForgeJobId}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
          >
            <Play className="size-3 fill-current" />
            View slides {doc.latestForgeSlideCount ? `· ${doc.latestForgeSlideCount}` : ''}
          </Link>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (window.confirm('Re-forge will create a new deck and use AI credits. Continue?')) {
                onForge(doc.id, { force: true });
              }
            }}
            className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-2.5" />}
            Re-forge
          </button>
        </div>
      );
    }
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={`/teacher/decks/${doc.latestForgeJobId}`}
          className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
        >
          <Play className="size-3 fill-current" />
          View slides
        </Link>
        <button
          type="button"
          disabled={isBusy}
          title="Re-forge with AI"
          onClick={() => {
            if (window.confirm('Re-forge will create a new deck and use AI credits. Continue?')) {
              onForge(doc.id, { force: true });
            }
          }}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
        >
          {isBusy ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
        </button>
      </div>
    );
  }

  if (state === 'in_progress' && doc.latestForgeJobId) {
    const linkClasses =
      variant === 'card'
        ? 'mt-auto flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400'
        : 'flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400';
    return (
      <Link href={`/teacher/decks/${doc.latestForgeJobId}`} className={linkClasses}>
        <Loader2 className="size-3 animate-spin" />
        Forging… view progress
      </Link>
    );
  }

  // none
  if (variant === 'card') {
    return (
      <button
        type="button"
        disabled={isBusy}
        onClick={() => onForge(doc.id)}
        className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
      >
        {isBusy
          ? <><Loader2 className="size-3 animate-spin" /> Forging…</>
          : <><Sparkles className="size-3" /> Forge slides</>}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={isBusy}
      onClick={() => onForge(doc.id)}
      className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
    >
      {isBusy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
      Forge
    </button>
  );
}

// ─── Doc Row (list view) ──────────────────────────────────────────────────────

function DocRow({ doc, forging, onForge, canForge = true, linkingSessionId, linked, linkingBusy, onLink }: DocActionProps) {
  const cfg = getFileConfig(doc.kind);
  const Icon = cfg.icon;

  // ── Linking mode: checkbox row ──
  if (linkingSessionId) {
    return (
      <motion.li
        variants={itemVariants}
        onClick={() => !linked && !linkingBusy && onLink?.(doc.id)}
        className={`flex items-center gap-4 border-b border-border/40 px-5 py-3.5 last:border-b-0 transition-all ${
          linked
            ? 'cursor-default bg-emerald-50/40 dark:bg-emerald-950/10'
            : 'cursor-pointer hover:bg-teal-50/40 dark:hover:bg-teal-900/10'
        }`}
      >
        {/* Checkbox */}
        <div className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
          linked ? 'border-emerald-500 bg-emerald-500' : 'border-border/60 hover:border-teal-400'
        }`}>
          {linkingBusy
            ? <Loader2 className="size-3 animate-spin text-teal-600" />
            : linked
            ? <CheckCircle2 className="size-3.5 text-white" />
            : null}
        </div>

        {/* Icon */}
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${cfg.bgCls}`}>
          <Icon className={`size-4.5 ${cfg.iconCls}`} />
        </div>

        {/* Title + meta */}
        <div className="min-w-0 flex-1">
          <p className="block truncate text-sm font-semibold">{doc.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {cfg.label} · {formatSize(doc.sizeBytes)} · {doc.uploaderName} · {formatRelativeTime(doc.createdAt)}
          </p>
        </div>

        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${ROUTE_BADGE[doc.route]}`}>
          {ROUTE_LABEL[doc.route]}
        </span>

        <span className={`shrink-0 text-[11px] font-semibold ${linked ? 'text-emerald-600 dark:text-emerald-400' : 'text-teal-600 dark:text-teal-400'}`}>
          {linked ? '✓ Added' : 'Click to add'}
        </span>
      </motion.li>
    );
  }

  // ── Normal mode ──
  return (
    <motion.li
      variants={itemVariants}
      className="flex items-center gap-4 border-b border-border/40 px-5 py-3.5 last:border-b-0 transition-colors hover:bg-muted/30"
    >
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${cfg.bgCls}`}>
        <Icon className={`size-4.5 ${cfg.iconCls}`} />
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={`/teacher/documents/${doc.id}`}
          className="block truncate text-sm font-semibold transition-colors hover:text-primary"
        >
          {doc.title}
        </Link>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {cfg.label} · {formatSize(doc.sizeBytes)} · {doc.uploaderName} · {formatRelativeTime(doc.createdAt)}
        </p>
      </div>

      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${ROUTE_BADGE[doc.route]}`}>
        {ROUTE_LABEL[doc.route]}
      </span>

      {canForge && <ForgeAction doc={doc} forging={forging} onForge={onForge} variant="row" />}
    </motion.li>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ hasFilters, onUpload }: { hasFilters: boolean; onUpload: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border/60 py-24 text-center"
    >
      <motion.div
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        className="flex size-16 items-center justify-center rounded-2xl bg-muted/60"
      >
        <FolderOpen className="size-7 text-muted-foreground" />
      </motion.div>
      <div>
        <p className="font-semibold">{hasFilters ? 'No matching documents' : 'Your library is empty'}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasFilters
            ? 'Try adjusting your search or filter.'
            : 'Upload your first document to get started.'}
        </p>
      </div>
      {!hasFilters && (
        <Button onClick={onUpload} className="gap-2">
          <Upload className="size-3.5" />
          Upload document
        </Button>
      )}
    </motion.div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function DocumentsLibraryClient({
  initialDocuments,
  canForge = true,
}: {
  initialDocuments: DocumentRow[];
  /** Residents save & view their own documents but cannot run the faculty-only
   *  AI forge / reclassify actions. */
  canForge?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [docs, setDocs] = useState(initialDocuments);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [routeFilter, setRouteFilter] = useState<RouteFilter>('ALL');
  const [showUpload, setShowUpload] = useState(false);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [forging, setForging] = useState<string | null>(null);

  const linkingSessionId = searchParams.get('session');
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [linkingBusy, setLinkingBusy] = useState<string | null>(null);

  async function linkToSession(docId: string) {
    if (!linkingSessionId) return;
    setLinkingBusy(docId);
    try {
      const headers = { 'Content-Type': 'application/json', ...csrfHeaders() };
      const tag = await fetch(`/api/documents/${docId}/tag-session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: linkingSessionId }),
      });
      if (!tag.ok) {
        const j = (await tag.json()) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? `Tag failed (${tag.status})`);
      }
      const add = await fetch(`/api/classroom/sessions/${linkingSessionId}/study-pack/documents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ documentId: docId }),
      });
      if (!add.ok) {
        const j = (await add.json()) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? `Add failed (${add.status})`);
      }
      setLinked(prev => new Set([...prev, docId]));
      toast.success('Added to session study pack');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLinkingBusy(null);
    }
  }

  const refresh = useCallback(async () => {
    const res = await fetch('/api/documents', { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as { ok: boolean; data?: { documents: DocumentRow[] } };
    if (json.ok && json.data) setDocs(json.data.documents);
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  async function approveRoute(id: string, route: DocumentRoute) {
    setClassifying(id);
    try {
      await fetch(`/api/documents/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route }),
      });
      await refresh();
    } finally {
      setClassifying(null);
    }
  }

  async function forgeSlides(id: string, opts: { force?: boolean } = {}) {
    setForging(id);
    try {
      const res = await fetch('/api/decks/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ documentId: id, ...(opts.force ? { force: true } : {}) }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { jobId: string; reused?: boolean };
        error?: { message: string };
      };
      if (!json.ok || !json.data) throw new Error(json.error?.message ?? `Forge failed (${res.status})`);
      router.push(`/teacher/decks/${json.data.jobId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setForging(null);
    }
  }

  const filtered = useMemo(() => {
    let result = docs;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter(d => d.title.toLowerCase().includes(q) || d.uploaderName.toLowerCase().includes(q));
    if (routeFilter !== 'ALL') result = result.filter(d => d.route === routeFilter);
    return result;
  }, [docs, search, routeFilter]);

  const hasFilters = Boolean(search.trim()) || routeFilter !== 'ALL';

  return (
    <div className="space-y-5">
      {/* Session-linking banner */}
      {linkingSessionId && (
        <div className="flex items-center gap-3 rounded-2xl border border-teal-200/70 bg-teal-50/60 px-4 py-3 dark:border-teal-800/30 dark:bg-teal-900/15">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-teal-600/15">
            <Plus className="size-4 text-teal-700 dark:text-teal-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-teal-900 dark:text-teal-300">Linking to session study pack</p>
            <p className="text-[11px] text-teal-700/70 dark:text-teal-400/60">
              Click any card below to add it. A button will appear to return once you&apos;re done.
            </p>
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or author…"
            className="h-10 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setViewMode('grid')}
            title="Grid view"
            className={`rounded-lg p-2 transition-colors ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60'}`}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            title="List view"
            className={`rounded-lg p-2 transition-colors ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60'}`}
          >
            <List className="size-4" />
          </button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button onClick={() => setShowUpload(true)} className="gap-2">
            <Upload className="size-3.5" />
            Upload
          </Button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(opt => (
          <motion.button
            key={opt.value}
            whileTap={{ scale: 0.95 }}
            onClick={() => setRouteFilter(opt.value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              routeFilter === opt.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
            {opt.value === 'ALL' && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[10px]">{docs.length}</span>
            )}
          </motion.button>
        ))}
      </div>

      {/* Document grid / list / empty */}
      <AnimatePresence mode="wait">
        {filtered.length === 0 ? (
          <EmptyState key="empty" hasFilters={hasFilters} onUpload={() => setShowUpload(true)} />
        ) : viewMode === 'grid' ? (
          <motion.div
            key="grid"
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {filtered.map(doc => (
              <DocCard
                key={doc.id}
                doc={doc}
                classifying={classifying}
                forging={forging}
                onApprove={approveRoute}
                onForge={forgeSlides}
                canForge={canForge}
                linkingSessionId={linkingSessionId}
                linked={linked.has(doc.id)}
                linkingBusy={linkingBusy === doc.id}
                onLink={linkToSession}
              />
            ))}
          </motion.div>
        ) : (
          <motion.ul
            key="list"
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="overflow-hidden rounded-2xl border border-border/80 bg-card"
          >
            {filtered.map(doc => (
              <DocRow
                key={doc.id}
                doc={doc}
                classifying={classifying}
                forging={forging}
                onApprove={approveRoute}
                onForge={forgeSlides}
                canForge={canForge}
                linkingSessionId={linkingSessionId}
                linked={linked.has(doc.id)}
                linkingBusy={linkingBusy === doc.id}
                onLink={linkToSession}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Upload modal */}
      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onSuccess={refresh}
      />

      {/* Sticky bottom bar — appears once at least one doc is linked */}
      <AnimatePresence>
        {linkingSessionId && linked.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
          >
            <div
              className="flex items-center gap-3 rounded-2xl px-5 py-3 shadow-2xl shadow-emerald-900/20"
              style={{ background: 'linear-gradient(135deg, #064E3B 0%, #065F46 100%)' }}
            >
              <div className="flex items-center gap-2 text-white">
                <CheckCircle2 className="size-5 text-emerald-300" />
                <span className="text-sm font-bold">
                  {linked.size} doc{linked.size !== 1 ? 's' : ''} added to session pack
                </span>
              </div>
              <div className="mx-1 h-5 w-px bg-white/20" />
              <Link
                href={`/classroom/${linkingSessionId}/study`}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-1.5 text-[13px] font-bold text-emerald-950 transition hover:bg-emerald-300"
              >
                Done — Back to session <ArrowLeft className="size-3.5 rotate-180" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

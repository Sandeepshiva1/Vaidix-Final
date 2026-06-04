'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  FileType,
  Lightbulb,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react'
import type { DocumentKind, DeckForgeStatus } from '@prisma/client'
import { cn } from '@/lib/utils'
import { SessionHeader } from '@/components/medlearn/session-header'
import type { SessionView } from '@/lib/medlearn/session-view'
import { ensureCsrfHeaders } from '@/lib/csrf-client'

// ─── Real session decks (loaded server-side from documentSessionLink) ────────
export interface SessionDeck {
  documentId: string
  name: string
  kind: DocumentKind
  savedAt: string
  /** Usable forge job id, or null if AI hasn't produced a deck yet. */
  jobId: string | null
  slideCount: number | null
  status: DeckForgeStatus | null
}

const ACCEPTED_TYPES: { kind: 'pdf' | 'pptx' | 'docx' | 'notes'; label: string; ext: string; icon: React.ReactNode }[] = [
  { kind: 'pdf', label: 'PDF', ext: '.pdf', icon: <FileText className="size-4" /> },
  { kind: 'pptx', label: 'PowerPoint', ext: '.pptx', icon: <FileType className="size-4" /> },
  { kind: 'docx', label: 'Word', ext: '.docx', icon: <FileText className="size-4" /> },
  { kind: 'notes', label: 'Notes / Articles', ext: '.txt', icon: <FileText className="size-4" /> },
]

const ACCEPT_ATTR =
  '.pptx,.ppt,.pdf,.docx,.doc,.txt,.md,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/vnd.ms-powerpoint,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/msword,text/plain,text/markdown'

const MAX_BYTES = 50 * 1024 * 1024

type StudioMode = 'choose' | 'upload' | 'create' | 'myppts'

// In-flight forge flow state. The slide editing itself happens in the REAL
// editor at /teacher/decks/[jobId] — we only own the upload → forge handoff.
type FlowState =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileName: string; percent: number }
  | { kind: 'forging'; fileName: string }
  // AI builder offline (503 / FORGE_FAILED): the file is still saved + linked,
  // so we surface a graceful path to My Documents rather than an error wall.
  | { kind: 'offline'; documentId: string; fileName: string }
  | { kind: 'error'; message: string }

// ─── Component ──────────────────────────────────────────────────────────────
export function StudioClient({ session, decks }: { session: SessionView; decks: SessionDeck[] }) {
  const router = useRouter()
  const [studioMode, setStudioMode] = useState<StudioMode>('choose')
  const [flow, setFlow] = useState<FlowState>({ kind: 'idle' })
  // Create mode: the typed prompt becomes the deck title / topic hint.
  const [prompt, setPrompt] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasDecks = decks.length > 0
  const busy = flow.kind === 'uploading' || flow.kind === 'forging'

  // ── Real upload → tag → forge → real editor ────────────────────────────────
  const runForgeFlow = async (file: File, titleHint?: string) => {
    if (file.size > MAX_BYTES) {
      setFlow({ kind: 'error', message: 'File is too large (50 MB max).' })
      return
    }

    let documentId: string
    try {
      setFlow({ kind: 'uploading', fileName: file.name, percent: 0 })
      documentId = await uploadDocumentMultipart({
        file,
        title: (titleHint || file.name.replace(/\.[^.]+$/, '')).slice(0, 120),
        description: `Slide source for session ${session.id}`,
        onProgress: (pct) => setFlow({ kind: 'uploading', fileName: file.name, percent: pct }),
      })
    } catch (err) {
      setFlow({ kind: 'error', message: (err as Error).message })
      return
    }

    // Link the document to this session (best-effort — failure here doesn't
    // block the forge, the file is already saved to My Documents).
    try {
      const headers = await ensureCsrfHeaders()
      await fetch(`/api/documents/${documentId}/tag-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        credentials: 'include',
        body: JSON.stringify({ sessionId: session.id }),
      })
    } catch {
      /* non-fatal — continue to forge */
    }

    // Forge the deck. AI is offline in this environment, so a 503 / FORGE_FAILED
    // is the expected path — handled gracefully, the upload is kept.
    setFlow({ kind: 'forging', fileName: file.name })
    try {
      const headers = await ensureCsrfHeaders()
      const res = await fetch('/api/decks/forge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        credentials: 'include',
        body: JSON.stringify({ documentId }),
      })
      const body = (await res.json().catch(() => null)) as
        | { data?: { jobId?: string }; error?: { code?: string; message?: string } }
        | null

      if (res.ok && body?.data?.jobId) {
        // Hand off to the REAL slide editor.
        router.push(`/teacher/decks/${body.data.jobId}`)
        return
      }

      const code = body?.error?.code
      if (res.status === 503 || code === 'AI_UNAVAILABLE' || code === 'FORGE_FAILED') {
        setFlow({ kind: 'offline', documentId, fileName: file.name })
        router.refresh()
        return
      }
      setFlow({
        kind: 'error',
        message: body?.error?.message || `Couldn't build slides (${res.status}).`,
      })
    } catch (err) {
      setFlow({ kind: 'error', message: (err as Error).message })
    }
  }

  const onUploadModeFile = (file: File) => {
    void runForgeFlow(file, session.title)
  }
  const onCreateModeFile = (file: File) => {
    void runForgeFlow(file, prompt.trim() || session.title)
  }

  // ── CHOOSE ─────────────────────────────────────────────────────────────────
  if (studioMode === 'choose') {
    const showMyPpts = hasDecks
    return (
      <div className="mx-auto max-w-4xl">
        <div className="border-b border-border/60 bg-background/50 px-0 py-4 backdrop-blur">
          <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 1 · My Presentation" />
        </div>
        <div className={cn('mt-8 grid grid-cols-1 gap-5', showMyPpts ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
          <button
            type="button"
            onClick={() => setStudioMode('upload')}
            className="group relative overflow-hidden rounded-3xl border-2 border-border/60 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-teal-500/50 hover:shadow-[0_12px_40px_-15px_oklch(0.45_0.15_165/0.3)]"
          >
            <div className="absolute -top-8 -right-8 size-28 rounded-full bg-teal-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300">
                <Upload className="size-7" />
              </div>
              <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Upload PPT / Keynote</h2>
              <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                Have an existing presentation? Upload it and let Vaidix&apos;s AI enhance readability, add interactions, and flag clinical compliance issues.
              </p>
              <ul className="mt-4 space-y-1.5 text-[12px] text-muted-foreground">
                {['Accepts .pptx, .key, .pdf', 'AI readability & density scoring', '18-rule clinical compliance check', 'One-click fix suggestions'].map((f) => (
                  <li key={f} className="flex items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-teal-500" />{f}</li>
                ))}
              </ul>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStudioMode('create')}
            className="group relative overflow-hidden rounded-3xl border-2 border-border/60 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-indigo-500/50 hover:shadow-[0_12px_40px_-15px_oklch(0.45_0.1_260/0.3)]"
          >
            <div className="absolute -top-8 -right-8 size-28 rounded-full bg-indigo-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-indigo-500/15 to-violet-500/10 text-indigo-700 dark:text-indigo-300">
                <Wand2 className="size-7" />
              </div>
              <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Create PPT with AI</h2>
              <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                Upload your source documents — guidelines, journal articles, notes — and let Vaidix build a complete, evidence-grounded presentation for you.
              </p>
              <ul className="mt-4 space-y-1.5 text-[12px] text-muted-foreground">
                {['Grounded in your uploaded sources', 'Custom AI prompt for structure & depth', 'Never hallucinates — cites only your docs', 'Fully editable output'].map((f) => (
                  <li key={f} className="flex items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-indigo-500" />{f}</li>
                ))}
              </ul>
            </div>
          </button>

          {showMyPpts && (
            <button
              type="button"
              onClick={() => setStudioMode('myppts')}
              className="group relative overflow-hidden rounded-3xl border-2 border-emerald-500/40 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-emerald-500/70 hover:shadow-[0_12px_40px_-15px_oklch(0.55_0.16_155/0.35)]"
            >
              <div className="absolute -top-8 -right-8 size-28 rounded-full bg-emerald-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-emerald-500/15 to-teal-500/10 text-emerald-700 dark:text-emerald-300">
                    <FileType className="size-7" />
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {decks.length} saved
                  </span>
                </div>
                <h2 className="mt-4 text-[19px] font-semibold tracking-tight">My PPTs</h2>
                <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                  {decks.length} presentation{decks.length !== 1 ? 's' : ''} saved. Edit any version, apply new AI suggestions, or download the enhanced slides.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {decks.slice(0, 3).map((p) => (
                    <li key={p.documentId} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span className="truncate font-medium text-foreground/80">{p.name}</span>
                      {p.slideCount != null && <span className="ml-auto shrink-0 tabular-nums">{p.slideCount} slides</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-3 py-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
                    <Edit3 className="size-3.5" />
                    Edit &amp; manage
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[12px] font-medium text-muted-foreground">
                    <Download className="size-3.5" />
                    Download
                  </span>
                </div>
              </div>
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── MY PPTS ──────────────────────────────────────────────────────────────
  if (studioMode === 'myppts') {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="border-b border-border/60 bg-background/50 px-0 py-4 backdrop-blur">
          <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 1 · My Presentation" />
        </div>

        <div className="mt-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight">My PPTs</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {decks.length} saved presentation{decks.length !== 1 ? 's' : ''} for this session
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStudioMode('choose')}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[13px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add new
            </button>
          </div>

          {decks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-8 text-center">
              <FileType className="mx-auto size-7 text-muted-foreground" />
              <h3 className="mt-3 text-[15px] font-semibold">No presentations yet</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Upload an existing deck or create one with AI — your saved presentations will appear here.
              </p>
              <button
                type="button"
                onClick={() => setStudioMode('choose')}
                className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-4 text-[13px] font-medium text-white hover:bg-slate-600"
              >
                <Plus className="size-3.5" />
                Add a presentation
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {decks.map((ppt) => {
                const ready = ppt.jobId != null
                return (
                  <div
                    key={ppt.documentId}
                    className="group flex items-center gap-4 rounded-2xl border border-border/60 bg-card p-4 transition-all hover:border-teal-500/40 hover:shadow-sm"
                  >
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-emerald-500/15 to-teal-500/10 text-emerald-700 dark:text-emerald-300">
                      <FileType className="size-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <div className="truncate text-[14px] font-semibold">{ppt.name}</div>
                        <span className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          ready
                            ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        )}>
                          {ready ? 'Slides ready' : 'Saved · not built'}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-muted-foreground">
                        {ppt.slideCount != null && <><span>{ppt.slideCount} slides</span><span>·</span></>}
                        <span>Saved {ppt.savedAt}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {ready ? (
                        <a
                          href={`/teacher/decks/${ppt.jobId}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/8 px-3.5 text-[12px] font-medium text-teal-700 transition-colors hover:bg-teal-500/15 dark:text-teal-300"
                        >
                          <Edit3 className="size-3.5" />
                          Open editor
                        </a>
                      ) : (
                        <a
                          href={`/teacher/documents/${ppt.documentId}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                        >
                          <FileText className="size-3.5" />
                          View document
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── UPLOAD / CREATE — real forge handoff ─────────────────────────────────
  const isUpload = studioMode === 'upload'

  return (
    <div className="mx-auto max-w-3xl">
      <div className="border-b border-border/60 bg-background/50 px-0 py-4 backdrop-blur">
        <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 1 · My Presentation" />
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => { if (!busy) { setStudioMode('choose'); setFlow({ kind: 'idle' }) } }}
          disabled={busy}
          className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          ← Back to options
        </button>

        <div className="mt-4 flex items-center gap-3">
          <div className={cn(
            'grid size-12 place-items-center rounded-2xl',
            isUpload
              ? 'bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300'
              : 'bg-linear-to-br from-indigo-500/15 to-violet-500/10 text-indigo-700 dark:text-indigo-300'
          )}>
            {isUpload ? <Upload className="size-6" /> : <Wand2 className="size-6" />}
          </div>
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">
              {isUpload ? 'Upload PPT / Keynote' : 'Create PPT with AI'}
            </h2>
            <p className="text-[13px] text-muted-foreground">
              {isUpload
                ? 'Upload your existing deck — Vaidix opens it in the slide editor.'
                : 'Upload a source document — Vaidix builds an evidence-grounded deck you can edit.'}
            </p>
          </div>
        </div>

        {/* Hidden real file input — shared by both modes. */}
        <input
          type="file"
          accept={ACCEPT_ATTR}
          ref={fileInputRef}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            if (isUpload) onUploadModeFile(f)
            else onCreateModeFile(f)
          }}
        />

        {/* Create mode: optional prompt / title hint. */}
        {!isUpload && (
          <div className="mt-6">
            <label className="text-[12px] font-medium text-muted-foreground">Presentation focus (optional)</label>
            <div className="mt-1.5 flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background p-1.5 pl-3.5 shadow-sm focus-within:border-indigo-500/50 focus-within:ring-3 focus-within:ring-indigo-500/15">
              <Sparkles className="size-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
                placeholder="e.g. Diabetic retinopathy — staging & management for PGY-1"
                className="h-9 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
              />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
              <Lightbulb className="size-3.5" />
              Vaidix only generates from your verified sources — clinical guidelines, journal articles, your notes.
            </p>
          </div>
        )}

        {/* Dropzone / picker — idle state. */}
        {(flow.kind === 'idle' || flow.kind === 'error') && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center transition-colors hover:border-teal-500/40 hover:bg-teal-500/5"
            >
              <Upload className="size-8 text-muted-foreground group-hover:text-teal-600 dark:group-hover:text-teal-300" />
              <div className="mt-1 text-[14px] font-semibold">
                {isUpload ? 'Choose your presentation file' : 'Choose a source document'}
              </div>
              <div className="text-[12px] text-muted-foreground">PDF · PowerPoint · Word · Notes · up to 50 MB</div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                {ACCEPTED_TYPES.map((t) => (
                  <span
                    key={t.kind}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 px-2.5 py-1 text-[11.5px] font-medium text-foreground/80"
                  >
                    {t.icon}
                    {t.label}
                  </span>
                ))}
              </div>
            </button>
            {flow.kind === 'error' && (
              <p role="alert" className="mt-3 flex items-center gap-1.5 text-[12.5px] text-rose-700 dark:text-rose-300">
                <AlertTriangle className="size-3.5" />
                {flow.message}
              </p>
            )}
          </div>
        )}

        {/* Uploading / forging — the demo's "uploading/generating" state. */}
        {(flow.kind === 'uploading' || flow.kind === 'forging') && (
          <div className="mt-6 rounded-3xl border border-teal-500/30 bg-teal-500/5 p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 shrink-0 animate-spin text-teal-600 dark:text-teal-300" />
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">
                  {flow.kind === 'uploading'
                    ? `Uploading ${flow.fileName}…`
                    : `Building your slides from ${flow.fileName}…`}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {flow.kind === 'uploading'
                    ? `${Math.round(flow.percent)}% uploaded`
                    : 'Vaidix is analysing your source and preparing the slide editor.'}
                </div>
              </div>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-foreground/5">
              <div
                className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500 transition-[width]"
                style={{
                  width: flow.kind === 'uploading' ? `${Math.max(4, flow.percent)}%` : '100%',
                }}
              />
            </div>
          </div>
        )}

        {/* AI builder offline — graceful, keep the upload. */}
        {flow.kind === 'offline' && (
          <div className="mt-6 rounded-3xl border border-amber-500/30 bg-amber-500/5 p-6">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">AI slide builder is offline</div>
                <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
                  We couldn&apos;t build the slides right now, but <span className="font-medium text-foreground/80">{flow.fileName}</span> was
                  saved to My Documents and linked to this session. You can open it there, or try building again later.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <a
                    href={`/teacher/documents/${flow.documentId}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-4 text-[12.5px] font-medium text-white hover:bg-slate-600"
                  >
                    <FileText className="size-3.5" />
                    Open in My Documents
                  </a>
                  <button
                    type="button"
                    onClick={() => setStudioMode('myppts')}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  >
                    View My PPTs
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlow({ kind: 'idle' })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                    Upload another
                  </button>
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5" />
                  Your file is saved — nothing was lost.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Server-proxied multipart upload (mirrors the Pre-conference uploader) ───
// Streams bytes to /api/documents/upload and resolves the new Document id,
// surfacing real progress via XHR upload events.
async function uploadDocumentMultipart({
  file,
  title,
  description,
  onProgress,
}: {
  file: File
  title: string
  description: string
  onProgress: (pct: number) => void
}): Promise<string> {
  const form = new FormData()
  form.append('title', title)
  form.append('description', description)
  form.append('file', file)

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/documents/upload', true)
    xhr.withCredentials = true
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress((ev.loaded / ev.total) * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const env = JSON.parse(xhr.responseText) as { data?: { document?: { id?: string } } }
          const id = env.data?.document?.id
          if (!id) return reject(new Error('Upload succeeded but no document id returned.'))
          resolve(id)
        } catch (e) {
          reject(new Error(`Could not parse upload response: ${(e as Error).message}`))
        }
        return
      }
      let msg = `Upload failed (${xhr.status})`
      try {
        const env = JSON.parse(xhr.responseText) as { error?: { message?: string } }
        if (env.error?.message) msg = env.error.message
      } catch { /* keep fallback */ }
      reject(new Error(msg))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    xhr.send(form)
  })
}

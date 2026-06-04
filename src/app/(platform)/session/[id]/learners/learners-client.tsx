'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileText,
  Film,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Loader2,
  Lock,
  NotebookPen,
  Plus,
  Sparkles,
  Stethoscope,
  Target,
  Trophy,
  Unlock,
  Upload,
  WifiOff,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { DocumentKind } from '@prisma/client'
import { cn } from '@/lib/utils'
import { ensureCsrfHeaders } from '@/lib/csrf-client'
import { SessionHeader } from '@/components/medlearn/session-header'
import type { SessionView } from '@/lib/medlearn/session-view'
import type { LearnerPrepConfig } from '@/app/api/classroom/sessions/[id]/learners/route'

export interface PrereadDoc {
  id: string
  title: string
  kind: DocumentKind
  sizeBytes: number
}

type Mcq = { id: string; q: string; options: string[]; correct: number }
type OpenEnded = { id: string; q: string }
type StudyArtifacts = NonNullable<LearnerPrepConfig['artifacts']>

interface PrereadKind {
  kind: 'pdf' | 'video' | 'docx' | 'notes'
  label: string
  icon: React.ReactNode
}

const PREREAD_TYPES: PrereadKind[] = [
  { kind: 'pdf', label: 'Preread PDF', icon: <FileText className="size-4" /> },
  { kind: 'pdf', label: 'Journal article', icon: <BookOpen className="size-4" /> },
  { kind: 'pdf', label: 'Guideline', icon: <ClipboardCheck className="size-4" /> },
  { kind: 'video', label: 'Video', icon: <Film className="size-4" /> },
  { kind: 'notes', label: 'Notes', icon: <NotebookPen className="size-4" /> },
  { kind: 'docx', label: 'Case study', icon: <Stethoscope className="size-4" /> },
]

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

let mcqUid = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(mcqUid++).toString(36)}`

export function LearnersClient({
  session,
  config,
  prereads,
}: {
  session: SessionView
  config: LearnerPrepConfig
  prereads: PrereadDoc[]
}) {
  const router = useRouter()

  const [lockUntilPreread, setLockUntilPreread] = useState(config.lockUntilPreread)
  const [collectAnalytics, setCollectAnalytics] = useState(config.collectAnalytics)
  const [mcqs, setMcqs] = useState<Mcq[]>(config.mcqs)
  const [openEnded, setOpenEnded] = useState<OpenEnded[]>(config.openEnded)

  const [open, setOpen] = useState<string | null>('prereads')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadKind, setUploadKind] = useState<PrereadKind | null>(null)
  const [saving, setSaving] = useState(false)

  // Real AI-generated study artifacts. Seeded from persisted config; one POST
  // regenerates all three. `offline` is set only when the AI backend 503s.
  const [artifacts, setArtifacts] = useState<StudyArtifacts | undefined>(config.artifacts)
  const [genState, setGenState] = useState<'idle' | 'loading' | 'offline'>('idle')

  const generateArtifacts = async () => {
    setGenState('loading')
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(`/api/classroom/sessions/${session.id}/learners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        credentials: 'include',
        body: JSON.stringify({ kind: 'all' }),
      })
      if (res.status === 503) {
        setGenState('offline')
        return
      }
      const json = (await res.json()) as {
        ok: boolean
        data?: { artifacts: StudyArtifacts }
        error?: { message: string }
      }
      if (!res.ok || !json.ok || !json.data) {
        // No real generated content to show — never fabricate; degrade to offline.
        setGenState('offline')
        return
      }
      setArtifacts(json.data.artifacts)
      setGenState('idle')
      toast.success('Study artifacts generated')
    } catch {
      setGenState('offline')
    }
  }

  const prereadsDone = prereads.length > 0
  const lockActive = lockUntilPreread
  const advancedUnlocked = !lockActive || prereadsDone

  // Real analytics are not collected in this environment (no learner attempts
  // pipeline). We only render the insight block from real data — there is none
  // yet, so it stays honestly empty.
  const hasAnalytics = false

  const save = async (): Promise<boolean> => {
    // Reject MCQs whose correct index is out of range before hitting the server.
    for (const m of mcqs) {
      if (m.correct >= m.options.length || m.options.some((o) => !o.trim()) || !m.q.trim()) {
        toast.error('Each MCQ needs a question, filled options, and a valid correct answer')
        return false
      }
    }
    setSaving(true)
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(`/api/classroom/sessions/${session.id}/learners`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrf },
        credentials: 'include',
        body: JSON.stringify({ lockUntilPreread, collectAnalytics, mcqs, openEnded }),
      })
      const json = (await res.json()) as { ok: boolean; error?: { message: string } }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
      toast.success('Learner prep saved')
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveAndContinue = async () => {
    if (await save()) router.push(`/session/${session.id}/pre`)
  }

  const addMcq = () => {
    setMcqs((q) => [...q, { id: newId('mcq'), q: '', options: ['', ''], correct: 0 }])
  }

  return (
    <div className="mx-auto max-w-5xl">
      <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 2 · Prepare Your Learners" />

      {/* Lock toggle */}
      <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-border/60 bg-card p-5 md:flex-row md:items-center md:gap-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-2xl',
              lockActive ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            )}
          >
            {lockActive ? <Lock className="size-5" /> : <Unlock className="size-5" />}
          </div>
          <div>
            <div className="text-[14.5px] font-semibold">Lock advanced content until preread completed</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              When ON, learners must finish prereads before flashcards, microlearning and infographics unlock.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLockUntilPreread((v) => !v)}
          role="switch"
          aria-checked={lockActive}
          className={cn(
            'ml-auto relative h-7 w-12 shrink-0 rounded-full border transition-colors',
            lockActive ? 'border-teal-500/50 bg-teal-500' : 'border-border/60 bg-foreground/10'
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-5.5 rounded-full bg-white shadow-sm transition-all',
              lockActive ? 'left-5' : 'left-0.5'
            )}
          />
        </button>
      </div>

      {/* Sections (accordion) */}
      <div className="space-y-3">
        {/* 1. Prereads */}
        <Section
          icon={<Upload className="size-[18px]" />}
          title="Preread material"
          subtitle={prereadsDone ? `${prereads.length} item${prereads.length > 1 ? 's' : ''} ready` : 'Required before advanced unlocks'}
          status={prereadsDone ? 'done' : 'pending'}
          open={open === 'prereads'}
          onToggle={() => setOpen(open === 'prereads' ? null : 'prereads')}
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {PREREAD_TYPES.map((k) => (
              <button
                key={k.label}
                type="button"
                onClick={() => { setUploadKind(k); setUploadOpen(true) }}
                className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background/60 px-3 py-2.5 text-[12.5px] font-medium text-foreground/85 transition-colors hover:border-teal-500/40 hover:bg-teal-500/5 hover:text-teal-700 dark:hover:text-teal-300"
              >
                <span className="text-muted-foreground">{k.icon}</span>
                {k.label}
                <Plus className="ml-auto size-3.5 opacity-60" />
              </button>
            ))}
          </div>

          {prereads.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {prereads.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-2.5 py-2 text-[12px]">
                  <div className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground/5 text-muted-foreground">
                    {f.kind === 'VIDEO' ? <Film className="size-3.5" /> : <FileText className="size-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate font-medium">{f.title}</div>
                    <div className="text-[10.5px] text-muted-foreground">{formatSize(f.sizeBytes)}</div>
                  </div>
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 2. Advanced content — real AI study artifacts (Gemini-backed). */}
        <Section
          icon={<Sparkles className="size-[18px]" />}
          title="Mind Maps"
          subtitle={
            !advancedUnlocked
              ? 'Locked until learners complete prereads'
              : artifacts
                ? 'AI-generated from your session topic & prereads'
                : 'Generate from your sources with AI'
          }
          status={advancedUnlocked ? 'info' : 'locked'}
          open={open === 'content'}
          onToggle={() => setOpen(open === 'content' ? null : 'content')}
        >
          <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-3', !advancedUnlocked && 'opacity-50')}>
            <ContentTile
              icon={<Layers className="size-4" />}
              label="Flashcards"
              count={artifacts?.flashcards.length}
              locked={!advancedUnlocked}
            >
              {artifacts ? (
                <ul className="space-y-1.5">
                  {artifacts.flashcards.map((c, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-border/60 bg-foreground/[0.02] px-2 py-1.5 text-[11px] leading-snug"
                    >
                      <div className="font-semibold text-foreground/90">{c.q}</div>
                      <div className="mt-0.5 text-muted-foreground">{c.a}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <GenerateArtifact
                  label="Flashcards"
                  disabled={!advancedUnlocked}
                  state={genState}
                  onGenerate={generateArtifacts}
                />
              )}
            </ContentTile>

            <ContentTile
              icon={<Film className="size-4" />}
              label="Microlearning"
              count={artifacts?.microlearning.length}
              locked={!advancedUnlocked}
            >
              {artifacts ? (
                <ul className="space-y-1.5">
                  {artifacts.microlearning.map((m, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-foreground/[0.02] px-2 py-1.5 text-[11px]"
                    >
                      <span className="text-teal-700 dark:text-teal-300">
                        {m.kind === 'video' ? <Film className="size-3.5" /> : m.kind === 'flash' ? <Layers className="size-3.5" /> : <BookOpen className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium leading-snug">{m.title}</span>
                      <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{m.dur}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <GenerateArtifact
                  label="Microlearning"
                  disabled={!advancedUnlocked}
                  state={genState}
                  onGenerate={generateArtifacts}
                />
              )}
            </ContentTile>

            <ContentTile
              icon={<ImageIcon className="size-4" />}
              label="Infographics"
              count={artifacts?.infographics.length}
              locked={!advancedUnlocked}
            >
              {artifacts ? (
                <ul className="space-y-1.5">
                  {artifacts.infographics.map((g, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-border/60 bg-foreground/[0.02] px-2 py-1.5 text-[11px] leading-snug"
                    >
                      <div className="font-semibold text-foreground/90">{g.title}</div>
                      <div className="mt-0.5 text-muted-foreground">{g.sub}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <GenerateArtifact
                  label="Infographics"
                  disabled={!advancedUnlocked}
                  state={genState}
                  onGenerate={generateArtifacts}
                />
              )}
            </ContentTile>
          </div>

          {artifacts && advancedUnlocked && (
            <button
              type="button"
              onClick={() => void generateArtifacts()}
              disabled={genState === 'loading'}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-teal-500/40 hover:bg-teal-500/5 hover:text-teal-700 disabled:opacity-50 dark:hover:text-teal-300"
            >
              {genState === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Regenerate with AI
            </button>
          )}

          {!advancedUnlocked && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <Lock className="size-3.5" />
              Toggle off lock or upload prereads to enable advanced content for learners.
            </div>
          )}
        </Section>

        {/* 3. Quiz */}
        <Section
          icon={<HelpCircle className="size-[18px]" />}
          title="Knowledge Priming Quiz"
          subtitle={`${mcqs.length} MCQ${mcqs.length === 1 ? '' : 's'} · Analytics ${collectAnalytics ? 'ON' : 'OFF'}`}
          status="info"
          open={open === 'quiz'}
          onToggle={() => setOpen(open === 'quiz' ? null : 'quiz')}
        >
          <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/60 p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold">Receive learner analytics</div>
                <div className="text-[11px] text-muted-foreground">See readiness, weak concepts, and most-missed questions.</div>
              </div>
              <button
                type="button"
                onClick={() => setCollectAnalytics((v) => !v)}
                role="switch"
                aria-checked={collectAnalytics}
                className={cn(
                  'relative h-7 w-12 shrink-0 rounded-full border transition-colors',
                  collectAnalytics ? 'border-teal-500/50 bg-teal-500' : 'border-border/60 bg-foreground/10'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-5.5 rounded-full bg-white shadow-sm transition-all',
                    collectAnalytics ? 'left-5' : 'left-0.5'
                  )}
                />
              </button>
            </div>

            {collectAnalytics && (
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <Metric icon={<Target className="size-3.5" />} label="Avg. score" value="—" accent />
                <Metric icon={<Trophy className="size-3.5" />} label="Readiness" value="—" />
                <Metric icon={<Layers className="size-3.5" />} label="Open-ended" value={openEnded.length.toString()} />
                <Metric icon={<HelpCircle className="size-3.5" />} label="MCQs" value={mcqs.length.toString()} />
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2.5">
            {mcqs.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] px-4 py-6 text-center text-[12px] text-muted-foreground">
                No MCQs yet — add your first priming question below.
              </div>
            )}
            {mcqs.map((m, i) => (
              <McqCard
                key={m.id}
                index={i}
                mcq={m}
                onChange={(next) => setMcqs((arr) => arr.map((x) => (x.id === m.id ? next : x)))}
                onRemove={() => setMcqs((arr) => arr.filter((x) => x.id !== m.id))}
              />
            ))}
            <button
              type="button"
              onClick={addMcq}
              disabled={mcqs.length >= 50}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border/60 bg-foreground/[0.02] px-3 py-2.5 text-[12.5px] font-medium text-muted-foreground hover:border-teal-500/40 hover:bg-teal-500/5 hover:text-teal-700 disabled:opacity-50 dark:hover:text-teal-300"
            >
              <Plus className="size-3.5" />
              Add MCQ ({mcqs.length})
            </button>

            {/* Open-ended questions */}
            <OpenEndedQuestions questions={openEnded} setQuestions={setOpenEnded} />
          </div>

          {collectAnalytics && hasAnalytics ? (
            <div className="mt-4 rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3.5">
              <div className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300" />
                <div>
                  <div className="text-[12.5px] font-semibold">Quick read on your learners</div>
                  {/* Real analytics insights would render here once learner attempts exist. */}
                </div>
              </div>
            </div>
          ) : collectAnalytics ? (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-border/60 bg-background/60 p-3.5 text-[11.5px] text-muted-foreground">
              <Lightbulb className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="text-[12.5px] font-semibold text-foreground">No learner analytics yet</div>
                Insights on readiness, weak concepts and most-missed questions appear here once learners attempt your quiz.
              </div>
            </div>
          ) : null}
        </Section>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-foreground/80 transition-colors hover:bg-foreground/5 disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save draft
        </button>
        <button
          type="button"
          onClick={() => void saveAndContinue()}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-60"
        >
          Save and continue
          <ArrowRight className="size-4" />
        </button>
      </div>

      {uploadOpen && uploadKind && (
        <PrereadUploadModal
          sessionId={session.id}
          specialty={session.specialty}
          kind={uploadKind}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ─── Preread upload (real document upload + tag-session) ───────────────────
function PrereadUploadModal({
  sessionId,
  specialty,
  kind,
  onClose,
  onUploaded,
}: {
  sessionId: string
  specialty: string
  kind: PrereadKind
  onClose: () => void
  onUploaded: () => void
}) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<'idle' | 'upload' | 'tag'>('idle')
  const [error, setError] = useState<string | null>(null)

  const busy = phase !== 'idle'

  const submit = async () => {
    if (!file || !title.trim()) {
      setError('Title and file are required')
      return
    }
    setError(null)
    try {
      const csrf = await ensureCsrfHeaders()

      setPhase('upload')
      const form = new FormData()
      form.append('title', title.trim())
      form.append('file', file)
      const upRes = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { ...csrf },
        credentials: 'include',
        body: form,
      })
      const upJson = (await upRes.json()) as {
        ok: boolean
        data?: { document: { id: string } }
        error?: { message: string }
      }
      if (!upRes.ok || !upJson.ok || !upJson.data) {
        throw new Error(upJson.error?.message ?? `Upload failed (HTTP ${upRes.status})`)
      }
      const documentId = upJson.data.document.id

      setPhase('tag')
      const tagRes = await fetch(`/api/documents/${documentId}/tag-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        credentials: 'include',
        body: JSON.stringify({ sessionId }),
      })
      const tagJson = (await tagRes.json()) as { ok: boolean; error?: { message: string } }
      if (!tagRes.ok || !tagJson.ok) {
        throw new Error(tagJson.error?.message ?? `Tag failed (HTTP ${tagRes.status})`)
      }

      toast.success(`"${title.trim()}" linked to this session`)
      onUploaded()
    } catch (e) {
      setError((e as Error).message)
      setPhase('idle')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-teal-500/10 text-teal-700 dark:text-teal-300">
              {kind.icon}
            </div>
            <div>
              <p className="text-sm font-bold">Add {kind.label}</p>
              <p className="text-[11px] text-muted-foreground">PDF, DOC, image, or video</p>
            </div>
          </div>
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${kind.label} — ${specialty}`}
              disabled={busy}
              maxLength={200}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-teal-500/50"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">File</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.md,.png,.jpg,.jpeg,.mp4,.mov"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-teal-500/10 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-teal-700"
            />
            {file && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <FileText className="size-3" />
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          )}
          {busy && (
            <div className="flex items-center gap-2 rounded-lg bg-teal-500/5 px-3 py-2 text-xs text-teal-700 dark:text-teal-300">
              <Loader2 className="size-3.5 animate-spin" />
              {phase === 'upload' ? 'Uploading file…' : 'Linking to session…'}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="rounded-full border border-border/60 bg-background/60 px-4 py-1.5 text-[13px] font-medium text-foreground/80 hover:bg-foreground/5 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !file || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-slate-600 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Upload
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AI study-artifact generation (real Gemini-backed; offline on 503) ─────
// Controlled by the parent: a single POST regenerates all three artifact kinds,
// so the parent owns the request/state and these per-tile buttons just trigger
// it and reflect the shared state. Never shows fabricated content.
function GenerateArtifact({
  label,
  disabled,
  state,
  onGenerate,
}: {
  label: string
  disabled: boolean
  state: 'idle' | 'loading' | 'offline'
  onGenerate: () => void | Promise<void>
}) {
  if (state === 'offline') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
        <WifiOff className="mt-0.5 size-3.5 shrink-0" />
        <span>AI builder offline — {label.toLowerCase()} can&apos;t be generated right now.</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void onGenerate()}
      disabled={disabled || state === 'loading'}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 bg-foreground/[0.02] px-2 py-2 text-[11.5px] font-medium text-muted-foreground hover:border-teal-500/40 hover:bg-teal-500/5 hover:text-teal-700 disabled:opacity-50 dark:hover:text-teal-300"
    >
      {state === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
      Generate with AI
    </button>
  )
}

// ─── Accordion / shared ────────────────────────────────────────────────────
function Section({
  icon,
  title,
  subtitle,
  status,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  status: 'done' | 'pending' | 'info' | 'locked'
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const statusBadge: Record<typeof status, React.ReactNode> = {
    done: <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3" /> Done</span>,
    pending: <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">Pending</span>,
    locked: <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300"><Lock className="size-3" /> Locked</span>,
    info: <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">Info</span>,
  }
  return (
    <div className="overflow-hidden rounded-3xl border border-border/60 bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-foreground/3"
      >
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-teal-500/12 to-emerald-500/8 text-teal-700 dark:text-teal-300">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold tracking-tight">{title}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2.5">
          {statusBadge[status]}
          {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </div>
      </button>
      {open && <div className="border-t border-border/60 p-5">{children}</div>}
    </div>
  )
}

function ContentTile({
  icon,
  label,
  count,
  locked,
  children,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  locked?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/60 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <span className="text-teal-700 dark:text-teal-300">{icon}</span>
        {label}
        {count !== undefined && (
          <span className="ml-auto rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{count}</span>
        )}
        {locked && <Lock className={cn('size-3 text-muted-foreground', count === undefined && 'ml-auto')} />}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

// ─── Faculty-authored MCQ card ─────────────────────────────────────────────
function McqCard({
  index,
  mcq,
  onChange,
  onRemove,
}: {
  index: number
  mcq: Mcq
  onChange: (next: Mcq) => void
  onRemove: () => void
}) {
  const setOption = (j: number, value: string) =>
    onChange({ ...mcq, options: mcq.options.map((o, k) => (k === j ? value : o)) })
  const addOption = () => {
    if (mcq.options.length >= 6) return
    onChange({ ...mcq, options: [...mcq.options, ''] })
  }
  const removeOption = (j: number) => {
    if (mcq.options.length <= 2) return
    const options = mcq.options.filter((_, k) => k !== j)
    const correct = mcq.correct >= options.length ? options.length - 1 : mcq.correct
    onChange({ ...mcq, options, correct })
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
      <div className="flex items-start gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-teal-500/10 font-mono text-[10.5px] font-semibold text-teal-700 dark:text-teal-300">
          Q{index + 1}
        </span>
        <textarea
          value={mcq.q}
          onChange={(e) => onChange({ ...mcq, q: e.target.value })}
          rows={2}
          placeholder="Type the MCQ stem…"
          className="min-w-0 flex-1 resize-none rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-[12.5px] font-medium leading-snug outline-none focus:border-teal-500/50"
        />
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-destructive"
          aria-label="Remove MCQ"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="mt-2.5 grid grid-cols-1 gap-1.5 md:grid-cols-2">
        {mcq.options.map((o, j) => (
          <li
            key={j}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px]',
              mcq.correct === j
                ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20'
                : 'bg-foreground/3'
            )}
          >
            <button
              type="button"
              onClick={() => onChange({ ...mcq, correct: j })}
              title="Mark as correct answer"
              className={cn(
                'grid size-4 shrink-0 place-items-center rounded-full border',
                mcq.correct === j ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border/60'
              )}
            >
              {mcq.correct === j && <CheckCircle2 className="size-3" />}
            </button>
            <span className="font-mono text-[10px] text-muted-foreground">{String.fromCharCode(65 + j)}.</span>
            <input
              value={o}
              onChange={(e) => setOption(j, e.target.value)}
              placeholder={`Option ${String.fromCharCode(65 + j)}`}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
            {mcq.options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(j)}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                aria-label="Remove option"
              >
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {mcq.options.length < 6 && (
        <button
          type="button"
          onClick={addOption}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-teal-700 dark:hover:text-teal-300"
        >
          <Plus className="size-3" /> Add option
        </button>
      )}
    </div>
  )
}

// ─── Faculty-authored open-ended questions ─────────────────────────────────
function OpenEndedQuestions({
  questions,
  setQuestions,
}: {
  questions: OpenEnded[]
  setQuestions: React.Dispatch<React.SetStateAction<OpenEnded[]>>
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const addQ = () => {
    const t = draft.trim()
    if (!t) return
    setQuestions((q) => [...q, { id: newId('oe'), q: t }])
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <NotebookPen className="size-4 text-teal-600 dark:text-teal-300" />
          Open-ended questions
          <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">{questions.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          <Plus className="size-3" />
          Add
        </button>
      </div>

      <div className="space-y-2.5">
        {questions.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] px-4 py-5 text-center text-[11.5px] text-muted-foreground">
            No open-ended questions yet — add your first reflection prompt.
          </div>
        )}
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
            <div className="flex items-start gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-indigo-500/10 font-mono text-[10.5px] font-semibold text-indigo-700 dark:text-indigo-300">
                OE{i + 1}
              </span>
              <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{q.q}</p>
              <button
                type="button"
                onClick={() => setQuestions((arr) => arr.filter((x) => x.id !== q.id))}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-destructive"
                aria-label="Remove question"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="mt-2 ml-8 rounded-lg border border-dashed border-border/60 bg-foreground/[0.02] px-3 py-2 text-[11px] text-muted-foreground">
              Learners type their response — visible to faculty in analytics
            </div>
          </div>
        ))}

        {adding && (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-3">
            <div className="mb-2 text-[11.5px] font-semibold text-indigo-700 dark:text-indigo-300">New open-ended question</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="Type your question — learners will respond in free text…"
              className="w-full resize-none rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-[12px] outline-none focus:border-teal-500/50"
            />
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={addQ} className="flex-1 rounded-xl bg-slate-700 py-1.5 text-[12px] font-medium text-white hover:bg-slate-600">Add question</button>
              <button type="button" onClick={() => { setAdding(false); setDraft('') }} className="rounded-xl border border-border/60 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/5">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-2.5',
        accent ? 'border-teal-500/30 bg-teal-500/5' : 'border-border/60 bg-background/60'
      )}
    >
      <div className="flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

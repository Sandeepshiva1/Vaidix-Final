'use client'

import { notFound, useParams, useRouter } from 'next/navigation'
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
  Lock,
  NotebookPen,
  Plus,
  Sparkles,
  Stethoscope,
  Target,
  Trophy,
  Unlock,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDemoState } from '@/components/demo/demo-state'
import { SessionHeader } from '@/components/demo/session-header'

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

const FLASHCARDS = [
  { q: 'What defines severe NPDR?', a: 'The 4-2-1 rule: 4 quadrants of haemorrhage, 2 of venous beading, or 1 of IRMA.' },
  { q: 'First-line for centre-involving DME?', a: 'Anti-VEGF (ranibizumab, aflibercept, bevacizumab) is first-line.' },
  { q: 'Risk factors for DR progression?', a: 'HbA1c, duration of DM, hypertension, dyslipidaemia, pregnancy.' },
  { q: 'When to start PRP?', a: 'High-risk PDR — NVD ≥ 1/3 disc area, NVE with VH/preretinal haemorrhage.' },
]

const MICROLEARNING = [
  { title: 'OCT in 90 seconds', dur: '1:32', kind: 'video' as const },
  { title: 'Pattern recognition: NPDR vs PDR', dur: '2 min', kind: 'reading' as const },
  { title: 'Quick-fire stages', dur: '45s', kind: 'flash' as const },
]

const INFOGRAPHICS = [
  { title: 'DR staging at a glance', sub: '1-page poster' },
  { title: 'Anti-VEGF vs steroid', sub: 'Side-by-side' },
  { title: 'Screening intervals', sub: 'Decision tree' },
]

const MCQS = [
  {
    q: 'A 56-year-old type-2 diabetic shows 4 quadrants of dot-blot haemorrhages, venous beading in 2 quadrants, and no IRMA. Stage?',
    options: ['Mild NPDR', 'Moderate NPDR', 'Severe NPDR', 'High-risk PDR'],
    correct: 2,
  },
  {
    q: 'Best first-line therapy for centre-involving DME with VA 6/18?',
    options: ['Anti-VEGF intravitreal', 'Focal/grid laser', 'Sub-tenon triamcinolone', 'Observation'],
    correct: 0,
  },
  {
    q: 'Which finding most directly indicates ischaemia on FFA?',
    options: ['Microaneurysms', 'Capillary non-perfusion', 'Hard exudates', 'Hyperfluorescent disc'],
    correct: 1,
  },
]

const ANALYTICS = {
  averageScore: 67,
  readiness: 72,
  weakConcepts: ['Severe NPDR criteria', 'Anti-VEGF protocols', 'PRP indications'],
  mostMissed: 'Best first-line therapy for centre-involving DME — only 41% picked Anti-VEGF',
}

export default function LearnersPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()
  const { getSession, uploadPrereads, updateSession, markStep } = useDemoState()
  const session = id ? getSession(id) : undefined

  const [open, setOpen] = useState<string | null>('prereads')

  if (!session) {
    if (typeof window !== 'undefined') return null
    return notFound()
  }

  const prereadsDone = session.prereadFiles.length > 0
  const lockActive = session.lockUntilPreread
  const advancedUnlocked = !lockActive || prereadsDone

  const addPreread = (k: PrereadKind) => {
    const name = `${k.label} — ${session.specialty}.pdf`
    uploadPrereads(session.id, [{ name, size: '1.4 MB', kind: k.kind }])
  }

  const send = () => {
    markStep(session.id, 'learners', true)
    router.push(`/demo/sessions/${session.id}/prepare`)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <SessionHeader session={session} backHref={`/demo/sessions/${session.id}/prepare`} eyebrow="Step 2 · Prepare Your Learners" />

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
          onClick={() => updateSession(session.id, { lockUntilPreread: !lockActive })}
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
          subtitle={prereadsDone ? `${session.prereadFiles.length} item${session.prereadFiles.length > 1 ? 's' : ''} ready` : 'Required before advanced unlocks'}
          status={prereadsDone ? 'done' : 'pending'}
          open={open === 'prereads'}
          onToggle={() => setOpen(open === 'prereads' ? null : 'prereads')}
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {PREREAD_TYPES.map((k) => (
              <button
                key={k.label}
                type="button"
                onClick={() => addPreread(k)}
                className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background/60 px-3 py-2.5 text-[12.5px] font-medium text-foreground/85 transition-colors hover:border-teal-500/40 hover:bg-teal-500/5 hover:text-teal-700 dark:hover:text-teal-300"
              >
                <span className="text-muted-foreground">{k.icon}</span>
                {k.label}
                <Plus className="ml-auto size-3.5 opacity-60" />
              </button>
            ))}
          </div>

          {session.prereadFiles.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {session.prereadFiles.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-2.5 py-2 text-[12px]">
                  <div className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground/5 text-muted-foreground">
                    {f.kind === 'video' ? <Film className="size-3.5" /> : <FileText className="size-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate font-medium">{f.name}</div>
                    <div className="text-[10.5px] text-muted-foreground">{f.size}</div>
                  </div>
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 2. Advanced content (locked) */}
        <Section
          icon={<Sparkles className="size-[18px]" />}
          title="Mind Maps"
          subtitle={advancedUnlocked ? 'Auto-generated from your sources' : 'Locked until learners complete prereads'}
          status={advancedUnlocked ? 'done' : 'locked'}
          open={open === 'content'}
          onToggle={() => setOpen(open === 'content' ? null : 'content')}
        >
          <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-3', !advancedUnlocked && 'opacity-50')}>
            {/* Flashcards */}
            <ContentTile
              icon={<Layers className="size-4" />}
              label="Flashcards"
              count={FLASHCARDS.length}
              locked={!advancedUnlocked}
            >
              <ul className="space-y-1.5 text-[11.5px]">
                {FLASHCARDS.slice(0, 2).map((c, i) => (
                  <li key={i} className="rounded-md bg-foreground/5 px-2 py-1.5">
                    <div className="font-medium">{c.q}</div>
                  </li>
                ))}
              </ul>
            </ContentTile>

            {/* Microlearning */}
            <ContentTile
              icon={<Film className="size-4" />}
              label="Microlearning"
              count={MICROLEARNING.length}
              locked={!advancedUnlocked}
            >
              <ul className="space-y-1.5 text-[11.5px]">
                {MICROLEARNING.map((m, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md bg-foreground/5 px-2 py-1.5">
                    <span className="truncate font-medium">{m.title}</span>
                    <span className="text-[10px] text-muted-foreground">{m.dur}</span>
                  </li>
                ))}
              </ul>
            </ContentTile>

            {/* Infographics */}
            <ContentTile
              icon={<ImageIcon className="size-4" />}
              label="Infographics"
              count={INFOGRAPHICS.length}
              locked={!advancedUnlocked}
            >
              <ul className="space-y-1.5 text-[11.5px]">
                {INFOGRAPHICS.map((g, i) => (
                  <li key={i} className="rounded-md bg-foreground/5 px-2 py-1.5">
                    <div className="font-medium">{g.title}</div>
                    <div className="text-[10px] text-muted-foreground">{g.sub}</div>
                  </li>
                ))}
              </ul>
            </ContentTile>
          </div>

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
          subtitle={`${MCQS.length} MCQs · Analytics ${session.collectAnalytics ? 'ON' : 'OFF'}`}
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
                onClick={() => updateSession(session.id, { collectAnalytics: !session.collectAnalytics })}
                role="switch"
                aria-checked={session.collectAnalytics}
                className={cn(
                  'relative h-7 w-12 shrink-0 rounded-full border transition-colors',
                  session.collectAnalytics ? 'border-teal-500/50 bg-teal-500' : 'border-border/60 bg-foreground/10'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-5.5 rounded-full bg-white shadow-sm transition-all',
                    session.collectAnalytics ? 'left-5' : 'left-0.5'
                  )}
                />
              </button>
            </div>

            {session.collectAnalytics && (
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <Metric icon={<Target className="size-3.5" />} label="Avg. score" value={`${ANALYTICS.averageScore}%`} accent />
                <Metric icon={<Trophy className="size-3.5" />} label="Readiness" value={`${ANALYTICS.readiness}%`} />
                <Metric icon={<Layers className="size-3.5" />} label="Weak concepts" value={ANALYTICS.weakConcepts.length.toString()} />
                <Metric icon={<HelpCircle className="size-3.5" />} label="MCQs" value={MCQS.length.toString()} />
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2.5">
            {MCQS.map((m, i) => (
              <div key={i} className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
                <div className="flex items-start gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-teal-500/10 font-mono text-[10.5px] font-semibold text-teal-700 dark:text-teal-300">
                    Q{i + 1}
                  </span>
                  <p className="text-[12.5px] font-medium leading-snug">{m.q}</p>
                </div>
                <ul className="mt-2.5 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                  {m.options.map((o, j) => (
                    <li
                      key={j}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px]',
                        m.correct === j
                          ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300'
                          : 'bg-foreground/3 text-foreground/80'
                      )}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">{String.fromCharCode(65 + j)}.</span>
                      {o}
                      {m.correct === j && <CheckCircle2 className="ml-auto size-3 text-emerald-500" />}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <button type="button" className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border/60 bg-foreground/[0.02] px-3 py-2.5 text-[12.5px] font-medium text-muted-foreground hover:border-teal-500/40 hover:bg-teal-500/5 hover:text-teal-700 dark:hover:text-teal-300">
              <Plus className="size-3.5" />
              Add MCQ ({MCQS.length}/5)
            </button>

            {/* Open-ended questions */}
            <OpenEndedQuestions />
          </div>

          {session.collectAnalytics && (
            <div className="mt-4 rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3.5">
              <div className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300" />
                <div>
                  <div className="text-[12.5px] font-semibold">Quick read on your learners</div>
                  <ul className="mt-1.5 space-y-1 text-[11.5px] leading-snug text-foreground/80">
                    <li>• Weak concepts: <span className="font-medium">{ANALYTICS.weakConcepts.join(', ')}</span></li>
                    <li>• Most missed: <span className="font-medium">{ANALYTICS.mostMissed}</span></li>
                    <li>• Lead with anti-VEGF protocols in the first 10 minutes.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Section>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2.5">
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-foreground/80 transition-colors hover:bg-foreground/5"
        >
          Save draft
        </button>
        <button
          type="button"
          onClick={send}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]"
        >
          Save and continue
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
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
  count: number
  locked?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/60 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <span className="text-teal-700 dark:text-teal-300">{icon}</span>
        {label}
        <span className="ml-auto rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{count}</span>
        {locked && <Lock className="ml-1 size-3 text-muted-foreground" />}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

const OPEN_ENDED_SEED = [
  { q: 'Describe one clinical scenario where you would delay anti-VEGF therapy in centre-involving DME. What factors guide your decision?' },
  { q: 'What is the most important thing you want to take away from this session and apply in your next clinic?' },
]

function OpenEndedQuestions() {
  const [questions, setQuestions] = useState(OPEN_ENDED_SEED)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const addQ = () => {
    const t = draft.trim()
    if (!t) return
    setQuestions((q) => [...q, { q: t }])
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
        {questions.map((q, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
            <div className="flex items-start gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-indigo-500/10 font-mono text-[10.5px] font-semibold text-indigo-700 dark:text-indigo-300">
                OE{i + 1}
              </span>
              <p className="text-[12.5px] font-medium leading-snug">{q.q}</p>
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
              className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-[12px] outline-none focus:border-teal-500/50 resize-none"
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

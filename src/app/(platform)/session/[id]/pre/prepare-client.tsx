'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowRight, BarChart3, CheckCircle2, ChevronRight, CircleDashed, FolderOpen,
  HelpCircle, Image as ImageIcon, PlayCircle, Sparkles, Users2, Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { WorkflowHeader } from '@/components/medlearn/workflow-header'
import type { SessionView, SVStepKey } from '@/lib/medlearn/session-view'

const PREP_STEPS: { key: SVStepKey; label: string; sub: string; sub2: string }[] = [
  { key: 'studio', label: 'My Presentation', sub: 'Upload or create slides with AI', sub2: 'studio' },
  { key: 'learners', label: 'Prepare Learners', sub: 'Prereads, mind maps & quiz', sub2: 'learners' },
  { key: 'promo', label: 'Invitations & Teasers', sub: 'Flyers, WhatsApp & Instagram posts', sub2: 'promo' },
  { key: 'analytics', label: 'Responses & Analytics', sub: 'Quiz results, engagement & leaderboard', sub2: 'analytics' },
  { key: 'questions', label: 'Incoming Questions', sub: 'Review what learners are asking', sub2: 'questions' },
  { key: 'ready', label: 'Session Ready', sub: 'Final checks & go-live', sub2: 'ready' },
]

const STEP_ICON: Record<string, React.ReactNode> = {
  studio: <Wand2 className="size-[18px]" />,
  learners: <Users2 className="size-[18px]" />,
  promo: <ImageIcon className="size-[18px]" />,
  analytics: <BarChart3 className="size-[18px]" />,
  questions: <HelpCircle className="size-[18px]" />,
  ready: <Sparkles className="size-[18px]" />,
}

export function PrepareClient({ session }: { session: SessionView }) {
  const router = useRouter()
  const [hovered, setHovered] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const steps = session.steps
  const done = PREP_STEPS.filter((s) => steps[s.key]).length
  const total = PREP_STEPS.length
  const pct = Math.round((done / total) * 100)

  const mandatoryDone = steps.studio // slides uploaded is the gate to go live
  const learnersSkipped = !steps.learners
  const href = (k: string) => `/session/${session.id}/${k}`

  return (
    <div className="mx-auto max-w-5xl">
      <WorkflowHeader
        title={session.title}
        date={session.date}
        time={session.time}
        duration={session.duration}
        specialty={session.specialty}
        type={session.type}
        eyebrow="Pre-Conference Workflow"
      />

      {/* Progress strip */}
      <div className="mb-8 rounded-3xl border border-border/60 bg-card p-6 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold tracking-widest text-muted-foreground uppercase">Readiness</div>
            <div className="mt-1 text-[28px] font-semibold tracking-tight">{done} of {total} steps complete</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[40px] font-semibold tabular-nums text-teal-700 dark:text-teal-300">{pct}%</div>
            <div className="text-[11.5px] font-medium text-muted-foreground">Ready to go live when 100%</div>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/5">
          <div className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {PREP_STEPS.map((step, idx) => {
            const d = steps[step.key]
            return (
              <div key={step.key} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium', d ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border/60 bg-background/60 text-muted-foreground')}>
                {d ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                <span className="opacity-70">{idx + 1}.</span>{step.label}
              </div>
            )
          })}
        </div>
      </div>

      {/* Link materials from My Documents */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-teal-500/10 text-teal-700 dark:text-teal-300"><FolderOpen className="size-5" /></div>
          <div>
            <div className="text-[14px] font-semibold tracking-tight">Materials & My Documents</div>
            <div className="text-[12.5px] text-muted-foreground">Link existing documents to this session, or upload new material.</div>
          </div>
        </div>
        <Link href={`/teacher/documents?session=${session.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-4 text-[13px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]">
          <FolderOpen className="size-4" /> Link from My Documents
        </Link>
      </div>

      {/* Step cards */}
      <ol className="relative space-y-3">
        <div className="absolute top-0 bottom-0 left-[27px] w-px bg-linear-to-b from-border/80 via-border/40 to-transparent" />
        {PREP_STEPS.map((step, idx) => {
          const d = steps[step.key]
          const prevDone = idx === 0 || PREP_STEPS.slice(0, idx).every((p) => steps[p.key])
          const active = !d && prevDone
          return (
            <li key={step.key} onMouseEnter={() => setHovered(step.key)} onMouseLeave={() => setHovered(null)} className="relative">
              <Link href={href(step.key)} className={cn('group relative flex items-center gap-5 rounded-3xl border bg-card p-5 pl-6 transition-all', d ? 'border-emerald-500/30 bg-emerald-500/5' : active ? 'border-teal-500/40 shadow-[0_4px_30px_-12px_oklch(0.45_0.15_165/0.3)]' : 'border-border/60 hover:border-foreground/15')}>
                <div className={cn('relative grid size-12 shrink-0 place-items-center rounded-2xl transition-all', d ? 'bg-emerald-500 text-white shadow-[0_6px_20px_-6px_oklch(0.7_0.18_155/0.6)]' : active ? 'bg-linear-to-br from-teal-500 to-emerald-500 text-white shadow-[0_6px_20px_-6px_oklch(0.55_0.16_165/0.6)]' : 'bg-foreground/5 text-muted-foreground')}>
                  {d ? <CheckCircle2 className="size-5" /> : <span className="font-mono text-[13px] font-semibold">{idx + 1}</span>}
                  {active && <span className="absolute -inset-1 -z-10 rounded-2xl bg-teal-500/15 blur-md" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 text-[15.5px] font-semibold tracking-tight">
                    <span className="text-teal-700/70 dark:text-teal-300/70">{STEP_ICON[step.key]}</span>
                    {step.label}
                    {d && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-300">Done</span>}
                    {active && !d && <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-teal-700 uppercase dark:text-teal-300">Active</span>}
                  </div>
                  <div className="mt-1 text-[13px] text-muted-foreground">{step.sub}</div>
                </div>
                <ChevronRight className={cn('size-5 text-muted-foreground transition-transform', hovered === step.key && 'translate-x-1 text-foreground')} />
              </Link>
            </li>
          )
        })}
      </ol>

      {/* CTA */}
      <div className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-border/60 bg-linear-to-br from-white via-teal-50/30 to-emerald-50/30 p-8 text-center dark:from-card dark:via-card dark:to-card">
        <div className="grid size-12 place-items-center rounded-full bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300"><PlayCircle className="size-6" /></div>
        <div>
          <h3 className="text-[18px] font-semibold tracking-tight">{mandatoryDone ? "You're ready to go live." : 'Add your presentation to enable Start Session.'}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">{mandatoryDone ? 'Open the Ready screen for a final check before going live.' : 'Vaidix will keep your work in sync across each step.'}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          <button type="button" disabled={!mandatoryDone} onClick={() => { if (learnersSkipped) setShowConfirm(true); else router.push(href('ready')) }} className={cn('inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-all', mandatoryDone ? 'bg-slate-700 text-white shadow-sm hover:scale-[1.02]' : 'cursor-not-allowed bg-foreground/10 text-muted-foreground')}>
            <Sparkles className="size-4" />I&apos;m Ready — Start Session<ArrowRight className="size-4" />
          </button>
          <Link href={href('live')} className="inline-flex h-11 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
            Preview live screen<ArrowRight className="size-4" />
          </Link>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
            <div className="px-6 pt-6">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300"><Sparkles className="size-6" /></div>
              <h2 className="mt-4 text-center text-[18px] font-semibold tracking-tight">Proceed without pre-read?</h2>
              <p className="mt-2 text-center text-[13px] text-muted-foreground leading-relaxed">You haven&apos;t prepared learner pre-reads or the priming quiz. Learners will join without any prior preparation material.</p>
            </div>
            <div className="flex gap-2.5 p-5">
              <button type="button" onClick={() => setShowConfirm(false)} className="flex-1 inline-flex h-11 items-center justify-center rounded-full border border-border/60 bg-background/60 text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/5">Go back</button>
              <button type="button" onClick={() => { setShowConfirm(false); router.push(href('ready')) }} className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-700 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]"><ArrowRight className="size-4" />Yes, continue</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

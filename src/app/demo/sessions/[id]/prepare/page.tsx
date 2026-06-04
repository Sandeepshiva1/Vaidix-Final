'use client'

import Link from 'next/link'
import { notFound, useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  HelpCircle,
  Image as ImageIcon,
  PlayCircle,
  Sparkles,
  Users2,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PREP_STEPS, stepCompletion, useDemoState, type DemoStepKey } from '@/components/demo/demo-state'
import { SessionHeader } from '@/components/demo/session-header'

const STEP_ICON: Record<string, React.ReactNode> = {
  studio: <Wand2 className="size-[18px]" />,
  learners: <Users2 className="size-[18px]" />,
  promo: <ImageIcon className="size-[18px]" />,
  analytics: <BarChart3 className="size-[18px]" />,
  questions: <HelpCircle className="size-[18px]" />,
  ready: <Sparkles className="size-[18px]" />,
}

export default function PreparePage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()
  const { getSession, markStep } = useDemoState()
  const session = id ? getSession(id) : undefined
  const [hovered, setHovered] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  if (!session) {
    if (typeof window !== 'undefined') {
      // Demo state hasn't hydrated yet on first paint — render skeleton.
      return <PrepareSkeleton />
    }
    return notFound()
  }

  const prog = stepCompletion(session)
  const mandatorySteps: DemoStepKey[] = ['studio', 'promo', 'analytics', 'questions']
  const mandatoryDone = mandatorySteps.every((k) => session.steps[k])
  const learnersSkipped = !session.steps.learners

  return (
    <div className="mx-auto max-w-5xl">
      <SessionHeader session={session} eyebrow="Pre-Conference Workflow" />

      {/* Progress strip */}
      <div className="mb-8 rounded-3xl border border-border/60 bg-card p-6 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold tracking-widest text-muted-foreground uppercase">Readiness</div>
            <div className="mt-1 text-[28px] font-semibold tracking-tight">
              {prog.done} of {prog.total} steps complete
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[40px] font-semibold tabular-nums text-teal-700 dark:text-teal-300">{prog.pct}%</div>
            <div className="text-[11.5px] font-medium text-muted-foreground">Ready to go live when 100%</div>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/5">
          <div
            className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500 transition-[width] duration-700 ease-out"
            style={{ width: `${prog.pct}%` }}
          />
        </div>

        {/* Step pills */}
        <div className="mt-5 flex flex-wrap gap-2">
          {PREP_STEPS.map((step, idx) => {
            const done = session.steps[step.key]
            return (
              <div
                key={step.key}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium',
                  done
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-border/60 bg-background/60 text-muted-foreground'
                )}
              >
                {done ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                <span className="opacity-70">{idx + 1}.</span>
                {step.label}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step cards */}
      <ol className="relative space-y-3">
        <div className="absolute top-0 bottom-0 left-[27px] w-px bg-linear-to-b from-border/80 via-border/40 to-transparent" />

        {PREP_STEPS.map((step, idx) => {
          const done = session.steps[step.key]
          const prevDone = idx === 0 || PREP_STEPS.slice(0, idx).every((p) => session.steps[p.key])
          const active = !done && prevDone
          return (
            <li
              key={step.key}
              onMouseEnter={() => setHovered(step.key)}
              onMouseLeave={() => setHovered(null)}
              className="relative"
            >
              <Link
                href={step.href(session.id)}
                className={cn(
                  'group relative flex items-center gap-5 rounded-3xl border bg-card p-5 pl-6 transition-all',
                  done
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : active
                      ? 'border-teal-500/40 shadow-[0_4px_30px_-12px_oklch(0.45_0.15_165/0.3)]'
                      : 'border-border/60 hover:border-foreground/15'
                )}
              >
                {/* numbered node */}
                <div
                  className={cn(
                    'relative grid size-12 shrink-0 place-items-center rounded-2xl transition-all',
                    done
                      ? 'bg-emerald-500 text-white shadow-[0_6px_20px_-6px_oklch(0.7_0.18_155/0.6)]'
                      : active
                        ? 'bg-linear-to-br from-teal-500 to-emerald-500 text-white shadow-[0_6px_20px_-6px_oklch(0.55_0.16_165/0.6)]'
                        : 'bg-foreground/5 text-muted-foreground'
                  )}
                >
                  {done ? <CheckCircle2 className="size-5" /> : <span className="font-mono text-[13px] font-semibold">{idx + 1}</span>}
                  {active && (
                    <span className="absolute -inset-1 -z-10 rounded-2xl bg-teal-500/15 blur-md" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 text-[15.5px] font-semibold tracking-tight">
                    <span className="text-teal-700/70 dark:text-teal-300/70">{STEP_ICON[step.key]}</span>
                    {step.label}
                    {done && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-300">
                        Done
                      </span>
                    )}
                    {active && !done && (
                      <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-teal-700 uppercase dark:text-teal-300">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[13px] text-muted-foreground">{step.sub}</div>
                </div>

                <ChevronRight
                  className={cn(
                    'size-5 text-muted-foreground transition-transform',
                    hovered === step.key && 'translate-x-1 text-foreground'
                  )}
                />
              </Link>

              {done && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    markStep(session.id, step.key, false)
                  }}
                  className="absolute top-2.5 right-3 hidden text-[10.5px] font-medium text-muted-foreground hover:text-foreground group-hover:block"
                >
                  Mark incomplete
                </button>
              )}
            </li>
          )
        })}
      </ol>

      {/* CTA */}
      <div className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-border/60 bg-linear-to-br from-white via-teal-50/30 to-emerald-50/30 p-8 text-center dark:from-card dark:via-card dark:to-card">
        <div className="grid size-12 place-items-center rounded-full bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300">
          <PlayCircle className="size-6" />
        </div>
        <div>
          <h3 className="text-[18px] font-semibold tracking-tight">
            {mandatoryDone ? "You're ready to go live." : 'Complete the steps above to enable Start Session.'}
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {mandatoryDone
              ? 'Open the Ready screen for a final check before going live.'
              : 'Vaidix will keep your work in sync across each step.'}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            disabled={!mandatoryDone}
            onClick={() => {
              if (learnersSkipped) { setShowConfirm(true) } else { router.push(`/demo/sessions/${session.id}/ready`) }
            }}
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-all',
              mandatoryDone
                ? 'bg-slate-700 text-white shadow-sm hover:scale-[1.02]'
                : 'cursor-not-allowed bg-foreground/10 text-muted-foreground'
            )}
          >
            <Sparkles className="size-4" />
            I&apos;m Ready — Start Session
            <ArrowRight className="size-4" />
          </button>
          <Link
            href={`/demo/sessions/${session.id}/live`}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            Preview live screen
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* Confirmation — learners skipped */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
            <div className="px-6 pt-6">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <Sparkles className="size-6" />
              </div>
              <h2 className="mt-4 text-center text-[18px] font-semibold tracking-tight">Proceed without pre-read?</h2>
              <p className="mt-2 text-center text-[13px] text-muted-foreground leading-relaxed">
                You haven&apos;t prepared learner pre-reads or the priming quiz. Learners will join without any prior preparation material.
              </p>
            </div>
            <div className="flex gap-2.5 p-5">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 inline-flex h-11 items-center justify-center rounded-full border border-border/60 bg-background/60 text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/5"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => { setShowConfirm(false); router.push(`/demo/sessions/${session.id}/ready`) }}
                className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-700 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]"
              >
                <ArrowRight className="size-4" />
                Yes, continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PrepareSkeleton() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse">
      <div className="mb-6 h-9 w-2/3 rounded-xl bg-foreground/5" />
      <div className="mb-8 h-40 rounded-3xl bg-foreground/5" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="mb-3 h-20 rounded-3xl bg-foreground/5" />
      ))}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  Image as ImageIcon,
  PartyPopper,
  PlayCircle,
  Radio,
  Sparkles,
  Users2,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { startSessionAction } from '@/components/medlearn/actions'
import { SessionHeader } from '@/components/medlearn/session-header'
import type { SessionView, SVStepKey } from '@/lib/medlearn/session-view'

const PREP_STEPS: { key: SVStepKey; label: string; href: (sid: string) => string }[] = [
  { key: 'studio', label: 'Upload or create slides with AI', href: (sid) => `/session/${sid}/studio` },
  { key: 'learners', label: 'Prereads, mind maps & quiz', href: (sid) => `/session/${sid}/learners` },
  { key: 'promo', label: 'Flyers, WhatsApp & Instagram posts', href: (sid) => `/session/${sid}/promo` },
  { key: 'analytics', label: 'Quiz results, engagement & leaderboard', href: (sid) => `/session/${sid}/analytics` },
  { key: 'questions', label: 'Review what learners are asking', href: (sid) => `/session/${sid}/questions` },
  { key: 'ready', label: 'Final checks & go-live', href: (sid) => `/session/${sid}/ready` },
]

const ICON_MAP: Record<SVStepKey, React.ReactNode> = {
  studio: <Wand2 className="size-[18px]" />,
  learners: <Users2 className="size-[18px]" />,
  promo: <ImageIcon className="size-[18px]" />,
  analytics: <BarChart3 className="size-[18px]" />,
  questions: <HelpCircle className="size-[18px]" />,
  ready: <Sparkles className="size-[18px]" />,
}

const CHECKLIST_LABEL: Record<SVStepKey, string> = {
  studio: 'Slides finalized',
  learners: 'Learner prep completed',
  promo: 'Invitations & teasers sent',
  analytics: 'Responses & analytics reviewed',
  questions: 'Questions reviewed',
  ready: 'Final readiness confirmation',
}

export function ReadyClient({ session }: { session: SessionView }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const isLive = session.stage === 'LIVE'
  const isPost = session.stage === 'POST'
  const room = `/classroom/${session.id}`

  // Every prep step is OPTIONAL. The checklist is guidance, not a gate: the
  // host can start the session at any time. `prepDone` only drives the
  // celebratory copy + whether we show a soft "some steps are still open"
  // confirmation — it never disables the Start button.
  const prepSteps: SVStepKey[] = ['studio', 'learners', 'promo', 'analytics', 'questions']
  const prepDone = prepSteps.every((k) => session.steps[k])
  const total = PREP_STEPS.length
  const doneCount = PREP_STEPS.filter((s) => session.steps[s.key]).length
  const prog = { done: doneCount, total, pct: Math.round((doneCount / total) * 100) }

  const doStart = async () => {
    setStarting(true)
    setShowConfirm(false)
    try {
      const result = await startSessionAction(session.id)
      if (result.ok) {
        router.push(room)
      } else {
        toast.error(result.error)
        setStarting(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the session.')
      setStarting(false)
    }
  }

  const handleStart = () => {
    // Never block. If anything is still open, ask for a soft confirmation so
    // an early start isn't accidental — but always allow it through.
    if (!prepDone) {
      setShowConfirm(true)
      return
    }
    void doStart()
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 5 · Session Ready" />

      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-white via-teal-50/40 to-emerald-50/30 p-8 text-center shadow-[0_2px_30px_-15px_oklch(0.45_0.15_165/0.25)] dark:from-card dark:via-card dark:to-card">
        <div className="absolute -top-16 -right-12 size-56 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="absolute -bottom-16 -left-12 size-56 rounded-full bg-emerald-300/15 blur-3xl" />

        <div className="relative">
          <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-linear-to-br from-teal-500 to-emerald-500 shadow-[0_10px_30px_-10px_oklch(0.55_0.16_165/0.6)]">
            {prepDone ? <PartyPopper className="size-7 text-white" /> : <Sparkles className="size-7 text-white" />}
          </div>
          <h1 className="mt-4 text-[28px] font-semibold tracking-tight md:text-[32px]">
            {prepDone ? 'Your session is ready.' : "You're ready to go live."}
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {prepDone
              ? "Vaidix has prepped your slides, learners, promos and questions. You're cleared for take-off."
              : 'The steps below are optional — start whenever you’re ready, or wrap them up first.'}
          </p>
        </div>
      </div>

      {/* Checklist */}
      <div className="mt-6 rounded-3xl border border-border/60 bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Final checklist</h2>
            <p className="text-[12px] text-muted-foreground">{prog.done} of {prog.total} steps complete · {prog.pct}%</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/5">
          <div
            className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500 transition-[width] duration-700 ease-out"
            style={{ width: `${prog.pct}%` }}
          />
        </div>

        <ul className="mt-5 space-y-2">
          {PREP_STEPS.map((step) => {
            const done = session.steps[step.key]
            const label = CHECKLIST_LABEL[step.key]
            const isReadyRow = step.key === 'ready'
            return (
              <li key={step.key}>
                <Link
                  href={isReadyRow ? '#' : step.href(session.id)}
                  onClick={(e) => isReadyRow && e.preventDefault()}
                  className={cn(
                    'flex items-center gap-4 rounded-2xl border p-3.5 transition-colors',
                    done
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-border/60 bg-background/60 hover:border-foreground/15',
                    isReadyRow && 'pointer-events-none opacity-90'
                  )}
                >
                  <div
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-xl',
                      done ? 'bg-emerald-500 text-white' : 'bg-foreground/5 text-muted-foreground'
                    )}
                  >
                    {done ? <CheckCircle2 className="size-5" /> : <CircleDashed className="size-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold">{label}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <span className="text-teal-600 dark:text-teal-300">{ICON_MAP[step.key]}</span>
                      {step.label}
                    </div>
                  </div>
                  {!done && !isReadyRow && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300">
                      Open
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      {/* CTA */}
      <div className="mt-6 flex flex-col items-center gap-3">
        {isPost ? (
          <Link
            href={`/session/${session.id}/post`}
            className="inline-flex h-14 items-center gap-2 rounded-full bg-slate-700 px-8 text-[15px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)] transition-all hover:scale-[1.02]"
          >
            <CheckCircle2 className="size-5" />
            View Post-Conference
            <ArrowRight className="size-5" />
          </Link>
        ) : isLive ? (
          <Link
            href={room}
            className="inline-flex h-14 items-center gap-2 rounded-full bg-slate-700 px-8 text-[15px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)] transition-all hover:scale-[1.02]"
          >
            <Radio className="size-5" />
            Join Live Room
            <ArrowRight className="size-5" />
          </Link>
        ) : (
          <button
            type="button"
            disabled={starting}
            onClick={handleStart}
            className={cn(
              'inline-flex h-14 items-center gap-2 rounded-full px-8 text-[15px] font-semibold transition-all',
              'bg-slate-700 text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)] hover:scale-[1.02]',
              starting && 'opacity-70'
            )}
          >
            {starting ? (
              <>Going live…</>
            ) : (
              <>
                <PlayCircle className="size-5" />
                I&apos;m Ready — Start Session
                <ArrowRight className="size-5" />
              </>
            )}
          </button>
        )}
        {!isLive && !isPost && !prepDone && (
          <p className="text-[12px] text-muted-foreground">
            The steps above are optional — you can start the session whenever you&apos;re ready.
          </p>
        )}
      </div>

      {/* Confirmation dialog — learners step skipped */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
            <div className="px-6 pt-6">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <HelpCircle className="size-6" />
              </div>
              <h2 className="mt-4 text-center text-[18px] font-semibold tracking-tight">Start with steps still open?</h2>
              <p className="mt-2 text-center text-[13px] text-muted-foreground leading-relaxed">
                Some prep steps (slides, learner pre-reads, promos, analytics or questions) aren&apos;t complete. They&apos;re optional — you can finish them later. Start the session now?
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
                onClick={doStart}
                className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-700 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]"
              >
                <PlayCircle className="size-4" />
                Yes, start anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

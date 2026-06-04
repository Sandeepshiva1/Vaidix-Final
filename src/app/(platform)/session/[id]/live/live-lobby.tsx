'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowRight, CalendarDays, CheckCircle2, Clock3, Loader2, PlayCircle,
  Radio, Users2, Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { startSessionAction } from '@/components/medlearn/actions'
import { WorkflowHeader } from '@/components/medlearn/workflow-header'
import type { SessionView, SVStepKey } from '@/lib/medlearn/session-view'

const STEPS: { key: SVStepKey; label: string }[] = [
  { key: 'studio', label: 'Presentation' },
  { key: 'learners', label: 'Learners' },
  { key: 'promo', label: 'Invites' },
  { key: 'questions', label: 'Questions' },
]

export function LiveLobby({ session, isHost }: { session: SessionView; isHost: boolean }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const room = `/classroom/${session.id}`
  const isLive = session.stage === 'LIVE'
  const isEnded = session.stage === 'POST'

  async function startAndEnter() {
    setStarting(true)
    try {
      const result = await startSessionAction(session.id)
      if (result.ok) router.push(room)
      else { toast.error(result.error); setStarting(false) }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the session.')
      setStarting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <WorkflowHeader
        title={session.title} date={session.date} time={session.time} duration={session.duration}
        specialty={session.specialty} type={session.type} backHref={`/session/${session.id}/pre`}
        eyebrow="Live Conference"
      />

      <div className="mt-6 overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-white via-teal-50/30 to-emerald-50/30 p-8 text-center dark:from-card dark:via-card dark:to-card">
        {/* Status pill */}
        <div className="flex justify-center">
          {isLive ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-rose-500/10 px-3.5 py-1 text-[12px] font-semibold uppercase tracking-wider text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300">
              <span className="size-2 animate-pulse rounded-full bg-rose-500" /> Live now
            </span>
          ) : isEnded ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-500/10 px-3.5 py-1 text-[12px] font-semibold uppercase tracking-wider text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300">
              <CheckCircle2 className="size-3.5" /> Ended
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3.5 py-1 text-[12px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300">
              <Clock3 className="size-3.5" /> Ready to start
            </span>
          )}
        </div>

        <div className="mx-auto mt-5 grid size-16 place-items-center rounded-3xl bg-linear-to-br from-teal-500 to-emerald-600 text-white shadow-[0_10px_30px_-8px_oklch(0.55_0.16_165/0.5)]">
          <Video className="size-8" />
        </div>

        <h1 className="mt-4 text-[24px] font-semibold tracking-tight">{session.title}</h1>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{new Date(`${session.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{session.time} · {session.duration} min</span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5"><Users2 className="size-3.5" />{session.counts.learners} invited</span>
        </div>

        {/* Readiness chips */}
        {!isEnded && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {STEPS.map((s) => {
              const done = session.steps[s.key]
              return (
                <span key={s.key} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium', done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border/60 bg-background/60 text-muted-foreground')}>
                  {done ? <CheckCircle2 className="size-3.5" /> : <span className="size-2 rounded-full bg-foreground/20" />}{s.label}
                </span>
              )
            })}
          </div>
        )}

        {/* Primary action */}
        <div className="mt-7 flex flex-col items-center gap-2.5">
          {isEnded ? (
            <Link href={`/session/${session.id}/post`} className="inline-flex h-12 items-center gap-2 rounded-full bg-teal-600 px-7 text-[15px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02]">
              <CheckCircle2 className="size-5" /> View Post-Conference <ArrowRight className="size-4" />
            </Link>
          ) : isLive ? (
            <Link href={room} className="inline-flex h-12 items-center gap-2 rounded-full bg-rose-500 px-7 text-[15px] font-semibold text-white shadow-[0_8px_24px_-6px_oklch(0.6_0.2_15/0.5)] transition-transform hover:scale-[1.02]">
              <Radio className="size-5" /> Join Live Room <ArrowRight className="size-4" />
            </Link>
          ) : isHost ? (
            <button type="button" onClick={startAndEnter} disabled={starting} className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-700 px-7 text-[15px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-60">
              {starting ? <Loader2 className="size-5 animate-spin" /> : <PlayCircle className="size-5" />}
              {starting ? 'Starting…' : 'Start & Go Live'} <ArrowRight className="size-4" />
            </button>
          ) : (
            <Link href={room} className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-700 px-7 text-[15px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02]">
              <Video className="size-5" /> Enter Live Room <ArrowRight className="size-4" />
            </Link>
          )}
          <p className="text-[12.5px] text-muted-foreground">
            {isEnded ? 'This session has ended.' : isLive ? 'The room is live — join with video & audio.' : isHost ? 'Starting opens the live video room for your learners.' : 'Opens the live video room.'}
          </p>
        </div>
      </div>
    </div>
  )
}

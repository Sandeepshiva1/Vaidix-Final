'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, CheckCircle2, MessageCircle, Users2 } from 'lucide-react'

export interface CompletedSession {
  id: string
  title: string
  specialty: string
  type: string
  date: string // YYYY-MM-DD
  learners: number
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export function CompletedSessionsClient({
  sessions,
  greetingName,
}: {
  sessions: CompletedSession[]
  greetingName: string
}) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to dashboard
        </Link>
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">Post-Conference</h2>
          <p className="text-[13px] text-muted-foreground">Learners can raise doubts for 7 days after each session ends.</p>
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border/60 bg-background/40 py-16 text-center text-[13.5px] text-muted-foreground">
          No completed sessions yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/session/${s.id}/post`}
              className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-teal-500/40 hover:shadow-[0_8px_30px_-15px_oklch(0.45_0.15_165/0.25)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300">
                      <CheckCircle2 className="size-3" />Completed
                    </span>
                    <span className="text-[11.5px] font-medium text-muted-foreground">{s.specialty}</span>
                    <span className="text-border">·</span>
                    <span className="text-[11.5px] font-medium text-muted-foreground">{fmtDate(s.date)}</span>
                  </div>
                  <h3 className="mt-2 text-[15px] font-semibold leading-snug tracking-tight">{s.title}</h3>
                  <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Users2 className="size-3.5" />{s.learners} learners</span>
                    <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <ArrowUpRight className="size-3.5" />Open post-conference
                    </span>
                  </div>
                </div>
                <div className="shrink-0 rounded-2xl border border-border/60 bg-foreground/[0.02] px-3 py-2 text-center">
                  <MessageCircle className="mx-auto size-4 text-muted-foreground" />
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">Post-conference</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

// ════════════════════════════════════════════════════════════════════════════
// DashboardClient — the demo "My Sessions" home (components/demo/page.tsx)
// reproduced on REAL session data. Hero + stat pills + Time/Type filters +
// real session cards (Build / Join Live / Post-Conference) + Completed view.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  ArrowUpRight, Bell, CalendarDays, CheckCircle2, Clock3, MessageCircle,
  Plus, Sparkles, TrendingUp, Users2, Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type DashStage = 'PRE' | 'LIVE' | 'POST'
export interface DashSession {
  id: string
  title: string
  description: string
  specialty: string
  type: string
  stage: DashStage
  date: string // YYYY-MM-DD
  time: string // h:mm am/pm
  duration: number
  learners: number
  progDone: number
  progTotal: number
}
export interface DashStats { upcoming: number; live: number; learners: number }

const TIME_FILTERS = ['Day', 'Week', 'Month', 'Year'] as const
type TimeFilter = (typeof TIME_FILTERS)[number]
const TYPE_FILTERS = ['All', 'Class Rooms', 'Board Rooms'] as const
type TypeFilter = (typeof TYPE_FILTERS)[number]

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background/60 px-3.5 py-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300">{icon}</div>
      <div className="leading-tight">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className="text-[15px] font-semibold tracking-tight">{value}</div>
      </div>
    </div>
  )
}

function StageBadge({ stage }: { stage: DashStage }) {
  const map: Record<DashStage, string> = {
    PRE: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20',
    LIVE: 'bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-rose-500/20',
    POST: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider ring-1 ring-inset', map[stage])}>
      {stage === 'LIVE' && <span className="size-1.5 animate-pulse rounded-full bg-rose-500" />}
      {stage}
    </span>
  )
}

export function DashboardClient({ sessions, stats, firstName }: { sessions: DashSession[]; stats: DashStats; firstName: string }) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('Week')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All')
  const [dashView, setDashView] = useState<'active' | 'completed'>('active')

  const liveSession = useMemo(() => sessions.find((s) => s.stage === 'LIVE') ?? null, [sessions])
  // Main "Your sessions" grid shows ONLY upcoming/active (PRE + LIVE). Completed
  // (POST) sessions are revealed via the "Completed Sessions" button.
  const upcomingSessions = useMemo(() => sessions.filter((s) => s.stage !== 'POST'), [sessions])
  const completedSessions = useMemo(() => sessions.filter((s) => s.stage === 'POST'), [sessions])

  if (dashView === 'completed') {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center gap-4">
          <button type="button" onClick={() => setDashView('active')} className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowUpRight className="size-3.5 rotate-[225deg]" /> Back to dashboard
          </button>
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">Completed Sessions</h2>
            <p className="text-[13px] text-muted-foreground">Learners can raise doubts for 7 days after each session ends.</p>
          </div>
        </div>
        {completedSessions.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-border/60 bg-background/40 py-16 text-center text-[13.5px] text-muted-foreground">No completed sessions yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {completedSessions.map((cs) => (
              <Link key={cs.id} href={`/session/${cs.id}/post`} className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-teal-500/40 hover:shadow-[0_8px_30px_-15px_oklch(0.45_0.15_165/0.25)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300"><CheckCircle2 className="size-3" />Completed</span>
                      <span className="text-[11.5px] font-medium text-muted-foreground">{fmtDate(cs.date)}</span>
                    </div>
                    <h3 className="mt-2 text-[15px] font-semibold leading-snug tracking-tight">{cs.title}</h3>
                    <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Users2 className="size-3.5" />{cs.learners} learners</span>
                      <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"><ArrowUpRight className="size-3.5" />Open post-conference</span>
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

  return (
    <div className="mx-auto max-w-7xl">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-white via-teal-50/40 to-emerald-50/30 px-8 py-9 shadow-[0_2px_30px_-15px_oklch(0.45_0.15_165/0.25)] dark:from-card dark:via-card dark:to-card">
        <div className="absolute -top-24 -right-20 size-72 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="absolute -bottom-24 -left-10 size-72 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-white/60 px-3 py-1 text-[11.5px] font-medium text-teal-700 backdrop-blur dark:bg-background/40 dark:text-teal-300">
              <Sparkles className="size-3.5" /> AI-assisted clinical teaching
            </div>
            <h1 className="mt-3 text-[34px] font-semibold tracking-tight md:text-[40px]" suppressHydrationWarning>{greeting()}, Dr. {firstName}.</h1>
            <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">Your next teaching session is being prepared. Vaidix has analysed your slides and is ready to help you create a polished, interactive experience for your learners.</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/sessions/new" className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-700 px-5 text-[14px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-100">
                <Plus className="size-4" /> Create New Session
              </Link>
              {liveSession && (
                <Link href={`/session/${liveSession.id}/live`} className="inline-flex h-11 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[14px] font-medium text-foreground backdrop-blur transition-colors hover:bg-foreground/5">
                  <Video className="size-4" /> Join Live — {liveSession.specialty}
                </Link>
              )}
              <button type="button" onClick={() => setDashView('completed')} className="inline-flex h-11 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[14px] font-medium text-foreground backdrop-blur transition-colors hover:bg-foreground/5">
                <CheckCircle2 className="size-4" /> Completed Sessions
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <StatPill icon={<CalendarDays className="size-4" />} label="Upcoming" value={stats.upcoming.toString()} />
            <StatPill icon={<Video className="size-4" />} label="Live now" value={stats.live.toString()} />
            <StatPill icon={<Users2 className="size-4" />} label="Active learners" value={stats.learners.toString()} />
          </div>
        </div>
      </section>

      {/* Filters */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-2xl border border-border/60 bg-card p-1">
          {TIME_FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setTimeFilter(f)} className={cn('h-8 rounded-xl px-3 text-[12.5px] font-medium transition-all', timeFilter === f ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>{f}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 rounded-2xl border border-border/60 bg-card p-1">
          {TYPE_FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setTypeFilter(f)} className={cn('h-8 rounded-xl px-3 text-[12.5px] font-medium transition-all', typeFilter === f ? 'bg-teal-500 text-white shadow-sm' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>{f}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <TrendingUp className="size-3.5" /><span>Showing {timeFilter.toLowerCase()} view · {typeFilter}</span>
        </div>
      </div>

      {/* Sessions */}
      <section className="mt-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">Your sessions</h2>
            <p className="text-[13.5px] text-muted-foreground">Click <span className="font-medium text-foreground">Build</span> to enter the guided pre-conference workflow.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {upcomingSessions.map((s) => {
            const pct = s.progTotal ? Math.round((s.progDone / s.progTotal) * 100) : 0
            return (
              <article key={s.id} className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)] transition-all hover:-translate-y-0.5 hover:border-teal-500/40 hover:shadow-[0_8px_30px_-15px_oklch(0.45_0.15_165/0.25)]">
                <div className="absolute -top-12 -right-12 size-40 rounded-full bg-teal-400/8 opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StageBadge stage={s.stage} />
                      <span className="text-[11.5px] font-medium text-muted-foreground">{s.specialty}</span>
                      <span className="text-border">·</span>
                      <span className="text-[11.5px] font-medium text-muted-foreground">{s.type}</span>
                    </div>
                    <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-tight">{s.title}</h3>
                    {s.description && <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">{s.description}</p>}
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-[12.5px]">
                  <div className="rounded-xl bg-foreground/[0.025] px-3 py-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="size-3.5" />Date</div>
                    <div className="mt-0.5 font-semibold">{fmtDate(s.date)}</div>
                  </div>
                  <div className="rounded-xl bg-foreground/[0.025] px-3 py-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground"><Clock3 className="size-3.5" />Time</div>
                    <div className="mt-0.5 font-semibold">{s.time}</div>
                  </div>
                  <div className="rounded-xl bg-foreground/[0.025] px-3 py-2">
                    <div className="text-muted-foreground">Duration</div>
                    <div className="mt-0.5 font-semibold">{s.duration} min</div>
                  </div>
                </div>
                <div className="mt-5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-muted-foreground">Preparation</span>
                    <span className="font-mono tabular-nums text-teal-700 dark:text-teal-300">{s.progDone}/{s.progTotal}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/5">
                    <div className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-2">
                  {s.stage === 'LIVE' ? (
                    <Link href={`/session/${s.id}/live`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-500 px-4 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-rose-500/90"><Video className="size-4" />Join Live</Link>
                  ) : s.stage === 'POST' ? (
                    <Link href={`/session/${s.id}/post`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-teal-600 px-4 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-teal-500"><CheckCircle2 className="size-4" />Post-Conference</Link>
                  ) : (
                    <Link href={`/session/${s.id}/pre`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-700 px-4 text-[13px] font-medium text-white shadow-sm transition-transform group-hover:scale-[1.01]"><Sparkles className="size-4" />Build</Link>
                  )}
                  <Link href={s.stage === 'LIVE' ? `/session/${s.id}/live` : s.stage === 'POST' ? `/session/${s.id}/post` : `/session/${s.id}/pre`} aria-label="Open session" className="inline-flex size-9 items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"><ArrowUpRight className="size-4" /></Link>
                </div>
              </article>
            )
          })}

          {/* Empty-creation CTA */}
          <Link href="/sessions/new" className="flex min-h-[260px] items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border/60 bg-background/40 p-6 text-muted-foreground transition-all hover:border-teal-500/40 hover:bg-teal-50/40 hover:text-teal-700 dark:hover:bg-teal-500/5">
            <div className="grid size-12 place-items-center rounded-full bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300"><Plus className="size-5" /></div>
            <div className="text-left">
              <div className="text-[14px] font-semibold">Create another session</div>
              <div className="text-[12px] text-muted-foreground">Classroom, Board Room, or Webinar</div>
            </div>
          </Link>
        </div>
      </section>
    </div>
  )
}

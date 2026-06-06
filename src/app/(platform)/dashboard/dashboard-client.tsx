'use client'

// ════════════════════════════════════════════════════════════════════════════
// DashboardClient — the demo "My Sessions" home (components/demo/page.tsx)
// reproduced on REAL session data. Hero + stat pills + Time/Type filters +
// real session cards (Build / Join Live / Post-Conference) + Completed view.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link'
import { toast } from 'sonner'
import { useMemo, useState } from 'react'
import { formatLocalDate, formatLocalTime, useMounted } from '@/lib/local-datetime'
import {
  Bell, BookOpen, CalendarDays, Check, CheckCircle2, Clock3, Link2,
  Pencil, Plus, Sparkles, TrendingUp, Users2, Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type DashStage = 'PRE' | 'LIVE' | 'POST'
export interface DashSession {
  id: string
  title: string
  specialty: string
  type: string
  stage: DashStage
  date: string // YYYY-MM-DD
  time: string // h:mm am/pm
  /** Raw start (ISO) — used to hide past sessions and apply the time-window filter. */
  startsAt: string
  /** Board Room vs Classroom — drives the All/Class Rooms/Board Rooms filter. */
  isBoardRoom: boolean
  duration: number
  learners: number
  progDone: number
  progTotal: number
  /** Per-activity completion for the 6 pre-conference steps (studio · learners ·
   *  promo · analytics · questions · ready) — drives the segmented progress bar. */
  prepSteps: boolean[]
  /** Viewer hosts this session. Non-hosts (cohort members / invitees) are
   *  routed to the learner-facing /classroom/[id] hub instead of the host
   *  /session/* prep+live workflow (which redirects non-hosts away). */
  isHost: boolean
  presenterName: string
}
export interface DashStats { upcoming: number; live: number }

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

const DAY_MS = 24 * 60 * 60 * 1000
// Forward-looking window from the start of today. Day = today only; Week = next
// 7 days; Month ≈ 31 days; Year ≈ 366 days. A LIVE/now session falls inside
// every window, so live sessions are never hidden by the time filter.
function withinTimeWindow(iso: string, filter: TimeFilter, nowMs: number): boolean {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return true
  const n = new Date(nowMs)
  const startOfToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
  const span = filter === 'Day' ? DAY_MS : filter === 'Week' ? 7 * DAY_MS : filter === 'Month' ? 31 * DAY_MS : 366 * DAY_MS
  return t >= startOfToday && t < startOfToday + span
}

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

// Robust clipboard copy: async Clipboard API on secure contexts, with a legacy
// execCommand fallback for http hosts (e.g. the LAN dev URL) where
// navigator.clipboard is undefined. Returns whether the copy succeeded.
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// Copy the session's join link (the learner-facing /classroom URL).
function ShareLinkButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const url = `${window.location.origin}/classroom/${sessionId}`
    const ok = await copyTextToClipboard(url)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      toast.success('Session link copied')
    } else {
      toast.error('Couldn’t copy automatically', { description: url })
    }
  }
  return (
    <button
      type="button" onClick={copy} title="Copy session link"
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/5"
    >
      {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Link2 className="size-3.5" />}
      {copied ? 'Copied' : 'Link'}
    </button>
  )
}

export function DashboardClient({ sessions, stats, greetingName }: { sessions: DashSession[]; stats: DashStats; greetingName: string }) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('Week')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All')
  // Snapshot "now" at mount so the past/future split and time-window are stable
  // across renders (avoids re-filtering on every keystroke elsewhere).
  const [nowMs] = useState(() => Date.now())
  // Once mounted, render each session's date/time in the VIEWER's timezone from
  // the raw `startsAt` instant. Before mount we keep the server-rendered
  // `date`/`time` strings so SSR and first paint match (no hydration mismatch);
  // on a UTC-hosted server they then correct to the user's local zone — fixing
  // "scheduled 4 PM shows as 10:30 AM".
  const mounted = useMounted()

  const liveSession = useMemo(() => sessions.find((s) => s.stage === 'LIVE') ?? null, [sessions])
  // Main "Your sessions" grid shows ONLY genuinely upcoming or live sessions:
  //   • drop POST (ended/cancelled)
  //   • drop stale PRE whose end time already passed (e.g. back-dated, never
  //     started) — these were leaking in and looking "completed"
  //   • apply the Type (All / Class Rooms / Board Rooms) and Time-window filters
  const upcomingSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (s.stage === 'POST') return false
      if (s.stage !== 'LIVE') {
        const endMs = new Date(s.startsAt).getTime() + s.duration * 60_000
        if (Number.isFinite(endMs) && endMs < nowMs) return false // already over
      }
      if (typeFilter === 'Class Rooms' && s.isBoardRoom) return false
      if (typeFilter === 'Board Rooms' && !s.isBoardRoom) return false
      if (s.stage !== 'LIVE' && !withinTimeWindow(s.startsAt, timeFilter, nowMs)) return false
      return true
    })
  }, [sessions, typeFilter, timeFilter, nowMs])

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
            <h1 className="mt-3 text-[34px] font-semibold tracking-tight md:text-[40px]" suppressHydrationWarning>{greeting()}, {greetingName}.</h1>
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
              <Link href="/sessions/completed" className="inline-flex h-11 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[14px] font-medium text-foreground backdrop-blur transition-colors hover:bg-foreground/5">
                <CheckCircle2 className="size-4" /> Completed Sessions
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <StatPill icon={<CalendarDays className="size-4" />} label="Upcoming" value={stats.upcoming.toString()} />
            <StatPill icon={<Video className="size-4" />} label="Live now" value={stats.live.toString()} />
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
            return (
              <article key={s.id} className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)] transition-all hover:-translate-y-0.5 hover:border-teal-500/40 hover:shadow-[0_8px_30px_-15px_oklch(0.45_0.15_165/0.25)]">
                <div className="absolute -top-12 -right-12 size-40 rounded-full bg-teal-400/8 opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StageBadge stage={s.stage} />
                      {s.isBoardRoom ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                          <Users2 className="size-3" />Board Room
                        </span>
                      ) : (
                        <>
                          <span className="text-[11.5px] font-medium text-muted-foreground">{s.specialty}</span>
                          <span className="text-border">·</span>
                          <span className="text-[11.5px] font-medium text-muted-foreground">{s.type}</span>
                        </>
                      )}
                    </div>
                    <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-tight">{s.title}</h3>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <div className="grid size-9 place-items-center rounded-full bg-linear-to-br from-teal-500/20 to-emerald-500/15 text-[13px] font-semibold text-teal-700 ring-1 ring-teal-500/20 dark:text-teal-300">
                      {s.presenterName.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('')}
                    </div>
                    <span className="max-w-27.5 truncate text-right text-[11px] font-medium text-muted-foreground">{s.presenterName}</span>
                  </div>
                </div>
                {/* Meta — date · time · duration, aligned left */}
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="size-3.5" /><span className="font-semibold text-foreground">{mounted ? formatLocalDate(s.startsAt) : fmtDate(s.date)}</span></span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Clock3 className="size-3.5" /><span className="font-semibold text-foreground">{mounted ? formatLocalTime(s.startsAt) : s.time}</span></span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Clock3 className="size-3.5 opacity-0" /><span className="font-semibold text-foreground">{s.duration} min</span></span>
                </div>

                {/* 6 pre-conference activities — done / active / pending. Board
                    rooms have no pre-conference, so show a one-line meeting note
                    instead of the prep progress bar. */}
                {s.isBoardRoom ? (
                  <div className="mt-4 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Users2 className="size-3.5 text-violet-500" />
                    Quick meeting — no preparation needed. Join directly when it&apos;s time.
                  </div>
                ) : (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-muted-foreground">Pre-conference activities</span>
                      <span className="font-mono tabular-nums text-teal-700 dark:text-teal-300">{s.progDone} of {s.progTotal} done</span>
                    </div>
                    <div className="mt-1.5 flex gap-1" aria-label={`${s.progDone} of ${s.progTotal} pre-conference activities complete`}>
                      {s.prepSteps.map((stepDone, i) => (
                        <div
                          key={i}
                          className={cn('h-1.5 flex-1 rounded-full transition-colors', stepDone ? 'bg-emerald-600' : 'bg-emerald-100 dark:bg-emerald-900/40')}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions — Build / Edit / Live (host) or Join/Open (learner).
                    Board rooms collapse all of this to a single direct Join (no
                    pre-conference build, no post-conference review). */}
                <div className="mt-5 flex items-center gap-2">
                  {s.isBoardRoom ? (
                    s.stage === 'POST' ? (
                      // Ended board room — view-only entry (no post-conference).
                      <span className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-foreground/[0.03] px-4 text-[13px] font-medium text-muted-foreground">
                        <CheckCircle2 className="size-4" />Meeting ended
                      </span>
                    ) : (
                      <>
                        <Link href={`/classroom/${s.id}`} className={cn('inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white shadow-sm transition-colors', s.stage === 'LIVE' ? 'bg-rose-500 hover:bg-rose-500/90' : 'bg-violet-600 hover:bg-violet-600/90')}>
                          {s.stage === 'LIVE' ? <><span className="size-1.5 animate-pulse rounded-full bg-white" />Join Live</> : <><Video className="size-3.5" />Join</>}
                        </Link>
                        {s.isHost && <ShareLinkButton sessionId={s.id} />}
                      </>
                    )
                  ) : s.isHost ? (
                    <>
                      {/* Build — guided pre-conference workflow (Review once it's over) */}
                      <Link href={s.stage === 'POST' ? `/session/${s.id}/post` : `/session/${s.id}/pre`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-700 px-4 text-[13px] font-medium text-white shadow-sm transition-transform group-hover:scale-[1.01]">
                        <Sparkles className="size-4" />{s.stage === 'POST' ? 'Review' : 'Build'}
                      </Link>
                      {/* Edit — available until the session starts */}
                      {s.stage === 'PRE' && (
                        <Link href={`/classroom/${s.id}/edit`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/5">
                          <Pencil className="size-3.5" />Edit
                        </Link>
                      )}
                      {/* Link — copy the shareable session link */}
                      <ShareLinkButton sessionId={s.id} />
                      {/* Live — join when actually live, otherwise clearly not live */}
                      {s.stage === 'LIVE' ? (
                        <Link href={`/session/${s.id}/live`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-rose-500 px-4 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-rose-500/90">
                          <span className="size-1.5 animate-pulse rounded-full bg-white" />Join Live
                        </Link>
                      ) : (
                        <span title="This session isn't live yet" className="inline-flex h-9 cursor-not-allowed items-center justify-center gap-1.5 rounded-full border border-border/60 bg-foreground/[0.03] px-4 text-[13px] font-medium text-muted-foreground">
                          <Video className="size-3.5" />Not live
                        </span>
                      )}
                    </>
                  ) : (
                    // Cohort members / invitees: route to the role-appropriate learner hub.
                    s.stage === 'LIVE' ? (
                      <>
                        <Link href={`/classroom/${s.id}`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-500 px-4 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-rose-500/90"><span className="size-1.5 animate-pulse rounded-full bg-white" />Join Live</Link>
                        <ShareLinkButton sessionId={s.id} />
                      </>
                    ) : s.stage === 'POST' ? (
                      <Link href={`/classroom/${s.id}/post`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-teal-600 px-4 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-teal-500"><CheckCircle2 className="size-4" />View &amp; Q&amp;A</Link>
                    ) : (
                      <>
                        <Link href={`/classroom/${s.id}/prepare`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-700 px-4 text-[13px] font-medium text-white shadow-sm transition-transform group-hover:scale-[1.01]"><BookOpen className="size-4" />Prepare</Link>
                        <ShareLinkButton sessionId={s.id} />
                        <Link href={`/classroom/${s.id}`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/5"><Video className="size-3.5" />Join</Link>
                      </>
                    )
                  )}
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

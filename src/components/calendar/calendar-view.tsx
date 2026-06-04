'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, dateFnsLocalizer, Views, type View, type SlotInfo } from 'react-big-calendar'
import {
  format, parse, startOfWeek, getDay, startOfMonth, endOfMonth,
  addMonths, addWeeks, addDays, setMonth, setYear,
  differenceInMinutes, isToday as dateFnsIsToday,
} from 'date-fns'
import { enUS } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { cn } from '@/lib/utils'
import {
  ChevronLeft, ChevronRight, CalendarDays, List, LayoutGrid,
  Clock, Loader2, AlertCircle, Video, Users, RefreshCw,
  BookOpen, Activity, Search, BookMarked, Wrench, ClipboardList,
} from 'lucide-react'
import type { SessionActivitySummary } from '@/app/api/calendar/session-activity-batch/route'
import { SessionPreviewPanel } from '@/components/calendar/session-preview-panel'
import { sessionBucket } from '@/lib/sessions/buckets'

const locales = { 'en-US': enUS }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales })

interface ApiEvent {
  id: string
  sessionId: string
  title: string
  start: string
  end: string
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  approvalStatus: 'DRAFT' | 'PENDING_FACULTY' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  openToAll: boolean
  sessionType: string
  host: { id: string; name: string; role: string } | null
  isRecurring: boolean
  isOccurrence: boolean
  cohortId: string | null
  cohortName: string | null
}

interface CalEvent {
  id: string
  sessionId: string
  title: string
  start: Date
  end: Date
  resource: ApiEvent
}

interface CalendarViewProps {
  canCreate: boolean
  userRole?: string
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function eventColor(e: ApiEvent): { bg: string; text: string; dot: string; border: string } {
  if (e.status === 'LIVE')                                   return { bg: '#dcfce7', text: '#14532d', dot: '#16a34a', border: '#4ade80' }
  if (e.approvalStatus === 'APPROVED')                       return { bg: '#d1fae5', text: '#064e3b', dot: '#059669', border: '#6ee7b7' }
  if (e.approvalStatus === 'PENDING_FACULTY')                return { bg: '#fef3c7', text: '#78350f', dot: '#d97706', border: '#fbbf24' }
  if (e.approvalStatus === 'DRAFT')                          return { bg: '#f1f5f9', text: '#334155', dot: '#64748b', border: '#94a3b8' }
  if (e.approvalStatus === 'CANCELLED' || e.status === 'CANCELLED') return { bg: '#fee2e2', text: '#7f1d1d', dot: '#ef4444', border: '#fca5a5' }
  return { bg: '#d1fae5', text: '#064e3b', dot: '#059669', border: '#6ee7b7' }
}

function statusLabel(e: ApiEvent): string {
  if (e.status === 'LIVE')                return 'LIVE'
  if (e.approvalStatus === 'DRAFT')       return 'DRAFT'
  if (e.approvalStatus === 'PENDING_FACULTY') return 'PENDING'
  if (e.approvalStatus === 'APPROVED')    return 'APPROVED'
  if (e.approvalStatus === 'CANCELLED' || e.status === 'CANCELLED') return 'CANCELLED'
  return ''
}

// ─── Session type config ──────────────────────────────────────────────────────

const SESSION_TYPE_CONFIG: Record<string, {
  label: string
  Icon: React.FC<{ className?: string }>
  pill: string
}> = {
  LECTURE:         { label: 'Lecture',         Icon: BookOpen,      pill: 'bg-violet-100 text-violet-700 border-violet-200' },
  GRAND_ROUNDS:    { label: 'Grand Rounds',    Icon: Activity,      pill: 'bg-sky-100 text-sky-700 border-sky-200' },
  CASE_CONFERENCE: { label: 'Case Conference', Icon: Search,        pill: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  JOURNAL_CLUB:    { label: 'Journal Club',    Icon: BookMarked,    pill: 'bg-amber-100 text-amber-700 border-amber-200' },
  SKILLS_WORKSHOP: { label: 'Skills Workshop', Icon: Wrench,        pill: 'bg-orange-100 text-orange-700 border-orange-200' },
  ASSESSMENT:      { label: 'Assessment',      Icon: ClipboardList, pill: 'bg-pink-100 text-pink-700 border-pink-200' },
}

// ─── Custom Event component (month/week/day views) ────────────────────────────

function EventTile({ event }: { event: CalEvent }) {
  const r = event.resource
  const c = eventColor(r)
  const label = statusLabel(r)
  return (
    <div
      className="flex h-full min-h-6 flex-col items-center justify-center overflow-hidden rounded-md px-1.5 py-0.5 text-center gap-0.5"
      style={{ background: c.bg, borderLeft: `3px solid ${c.dot}` }}
    >
      <span className="truncate w-full text-[11px] font-semibold leading-tight" style={{ color: c.text }}>
        {event.title}
      </span>
      {label === 'LIVE' && (
        <span className="shrink-0 rounded-full bg-green-500 px-1.5 py-0 text-[9px] font-bold text-white leading-tight">
          LIVE
        </span>
      )}
    </div>
  )
}

// ─── Custom Toolbar ───────────────────────────────────────────────────────────

interface ToolbarProps {
  date: Date
  view: View
  onNavigate: (action: 'PREV' | 'NEXT' | 'TODAY') => void
  onView: (view: View) => void
  onJumpTo: (date: Date) => void
}

const VIEW_ICONS: Record<string, React.ReactNode> = {
  month:  <LayoutGrid className="size-3.5" />,
  week:   <CalendarDays className="size-3.5" />,
  day:    <Clock className="size-3.5" />,
  agenda: <List className="size-3.5" />,
}
const VIEW_LABELS: Record<string, string> = { month: 'Month', week: 'Week', day: 'Day', agenda: 'Sessions' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function MonthYearPicker({ date, onPick, onClose }: { date: Date; onPick: (d: Date) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [year, setLocalYear] = useState(date.getFullYear())

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-border bg-card p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => setLocalYear((y) => y - 1)}
          className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="Previous year"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-bold text-foreground">{year}</span>
        <button
          onClick={() => setLocalYear((y) => y + 1)}
          className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="Next year"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS.map((m, idx) => {
          const isCurrent = year === date.getFullYear() && idx === date.getMonth()
          return (
            <button
              key={m}
              onClick={() => {
                onPick(setMonth(setYear(date, year), idx))
                onClose()
              }}
              className={cn(
                'rounded-lg px-2 py-2 text-xs font-semibold transition',
                isCurrent
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground hover:bg-accent'
              )}
            >
              {m}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CustomToolbar({ date, view, onNavigate, onView, onJumpTo }: ToolbarProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const monthYear = format(date, 'MMMM yyyy')
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onNavigate('TODAY')}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
        >
          Today
        </button>
        <div className="relative flex items-center rounded-lg border border-border bg-card shadow-sm">
          <button
            onClick={() => onNavigate('PREV')}
            className="rounded-l-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="Previous"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="border-x border-border px-3 py-1 text-sm font-bold text-foreground transition hover:bg-accent min-w-35 text-center"
            aria-label="Pick month"
          >
            {monthYear}
          </button>
          <button
            onClick={() => onNavigate('NEXT')}
            className="rounded-r-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="Next"
          >
            <ChevronRight className="size-4" />
          </button>
          {pickerOpen && (
            <MonthYearPicker date={date} onPick={onJumpTo} onClose={() => setPickerOpen(false)} />
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {(['month', 'week', 'day', 'agenda'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition sm:px-3',
              view === v
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background hover:text-foreground'
            )}
          >
            {VIEW_ICONS[v]}
            <span className="hidden sm:inline">{VIEW_LABELS[v]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Legend strip ─────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3">
      {[
        { dot: '#16a34a', label: 'Live now' },
        { dot: '#2563eb', label: 'Approved' },
        { dot: '#d97706', label: 'Pending approval' },
        { dot: '#94a3b8', label: 'Draft' },
        { dot: '#f43f5e', label: 'Cancelled' },
      ].map(({ dot, label }) => (
        <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full shrink-0" style={{ background: dot }} />
          {label}
        </span>
      ))}
    </div>
  )
}

// ─── Sessions feed (replaces agenda table) ────────────────────────────────────

function ActivityStrip({ activity, status }: { activity: SessionActivitySummary; status: string }) {
  const { cohortSize: n, preReadyCount: pre, liveActiveCount: active, liveAttendedCount: attended, postDoneCount: post } = activity
  const hasCohort = n > 0
  const pct = (v: number) => hasCohort ? Math.round((Math.min(v, n) / n) * 100) : 0

  type Cell = { label: string; value: number; color: string; bg: string; show: boolean }
  const cells: Cell[] = [
    { label: 'PRE', value: pre, color: '#3b82f6', bg: '#eff6ff', show: true },
    {
      label: status === 'LIVE' ? 'ACTIVE' : 'ATTENDED',
      value: status === 'LIVE' ? active : attended,
      color: status === 'LIVE' ? '#22c55e' : '#10b981',
      bg: status === 'LIVE' ? '#f0fdf4' : '#ecfdf5',
      show: status === 'LIVE' || status === 'ENDED',
    },
    { label: 'POST', value: post, color: '#8b5cf6', bg: '#f5f3ff', show: status === 'ENDED' },
  ]

  return (
    <div className="flex items-stretch gap-2">
      {cells.filter((c) => c.show).map((c) => (
        <div
          key={c.label}
          className="flex min-w-12 flex-col gap-1 rounded-lg px-2.5 py-1.5"
          style={{ background: c.bg }}
        >
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: c.color, opacity: 0.7 }}>
            {c.label}
          </span>
          <span className="text-sm font-bold tabular-nums leading-none text-foreground">
            {c.value}
            {hasCohort && <span className="text-[11px] font-medium text-muted-foreground">/{n}</span>}
          </span>
          {hasCohort && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct(c.value)}%`, background: c.color }}
              />
            </div>
          )}
        </div>
      ))}
      {status === 'LIVE' && (
        <span className="self-center inline-flex items-center gap-1 rounded-full bg-green-500 px-2 py-1 text-[11px] font-bold text-white">
          <span className="relative flex size-1.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-white" />
          </span>
          LIVE
        </span>
      )}
    </div>
  )
}

function SessionCard({
  event, index, activity, onSelect,
}: {
  event: CalEvent
  index: number
  activity?: SessionActivitySummary
  onSelect: () => void
}) {
  const r = event.resource
  const c = eventColor(r)
  const label = statusLabel(r)
  const typeCfg = SESSION_TYPE_CONFIG[r.sessionType]
  const mins = differenceInMinutes(event.end, event.start)
  const dur = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}m` : ''}` : `${mins}m`
  const showActivity = !!activity

  return (
    <motion.button
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.025, duration: 0.18 }}
      whileHover={{ x: 2 }}
      onClick={onSelect}
      className="group w-full flex items-center gap-0 rounded-lg border border-border/60 bg-card text-left transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm overflow-hidden"
    >
      {/* Status accent */}
      <div className="w-0.5 self-stretch shrink-0" style={{ background: c.dot }} />

      {/* Time */}
      <div className="shrink-0 w-15.5 px-3 text-right">
        <p className="text-[11px] font-bold tabular-nums text-foreground leading-none">
          {format(event.start, 'h:mm')}
          <span className="text-[9px] font-medium text-muted-foreground ml-0.5">{format(event.start, 'a')}</span>
        </p>
        <p className="text-[9px] text-muted-foreground/60 mt-0.5">{dur}</p>
      </div>

      {/* Thin separator */}
      <div className="h-7 w-px bg-border/50 shrink-0" />

      {/* Type icon square */}
      {typeCfg ? (
        <div className={cn('mx-2.5 flex size-6 shrink-0 items-center justify-center rounded-md border', typeCfg.pill)}>
          <typeCfg.Icon className="size-3" />
        </div>
      ) : (
        <div className="mx-2.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <Video className="size-3 text-muted-foreground" />
        </div>
      )}

      {/* Title — grows to fill available space */}
      <div className="flex-1 min-w-0 py-2.5 pr-4">
        <p className="text-sm font-semibold text-foreground truncate leading-none">
          {event.title}
        </p>
      </div>

      {/* Right info — shrink-0, sits on the right */}
      <div className="shrink-0 flex items-center gap-3 py-2">
        {/* Organizer + cohort */}
        <div className="flex flex-col gap-0.5">
          {r.host && (
            <span className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-foreground whitespace-nowrap">{r.host.name}</span>
              <span
                className="rounded px-1 py-px font-bold uppercase tracking-wide text-[8px] shrink-0"
                style={{ background: 'oklch(0.45 0.15 165 / 0.1)', color: 'oklch(0.35 0.15 165)' }}
              >
                {r.host.role.replace(/_/g, ' ')}
              </span>
            </span>
          )}
          {r.cohortId ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="size-3 shrink-0" />
              <span className="font-medium text-foreground">{r.cohortName ?? 'Cohort'}</span>
              {activity?.cohortSize ? (
                <span className="text-muted-foreground/60">· {activity.cohortSize} students</span>
              ) : null}
            </span>
          ) : (
            r.isRecurring && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <RefreshCw className="size-2.5" />
                Recurring
              </span>
            )
          )}
        </div>

        {showActivity && (
          <>
            <div className="h-8 w-px bg-border/50 shrink-0" />
            <ActivityStrip activity={activity!} status={r.status} />
          </>
        )}

        {!showActivity && (
          <>
            {label === 'LIVE' && (
              <span className="flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold text-white shrink-0">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                </span>
                LIVE
              </span>
            )}
            {label === 'PENDING' && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 shrink-0">PENDING</span>
            )}
            {label === 'DRAFT' && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 shrink-0">DRAFT</span>
            )}
            {label === 'CANCELLED' && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-500 shrink-0">CANCELLED</span>
            )}
          </>
        )}
      </div>

      {/* Direct Join button — skips the preview-panel intermediate step
          ("3 clicks to join" was the user complaint). Visible for any
          session that's joinable (LIVE / scheduled). Hidden for past +
          cancelled. Clicking it does NOT trigger the row's onSelect — the
          row still opens the preview if the user wants details. */}
      {(label === 'LIVE' || label === 'PENDING' || (!label && r.status !== 'ENDED' && r.status !== 'CANCELLED')) && (
        <Link
          href={`/classroom/${event.sessionId}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'shrink-0 mr-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold transition-all active:scale-95',
            label === 'LIVE'
              ? 'bg-green-500 text-white shadow-sm shadow-green-500/40 hover:bg-green-400'
              : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20',
          )}
        >
          {label === 'LIVE' ? (
            <>
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-white" />
              </span>
              Join now
            </>
          ) : (
            <>Join</>
          )}
        </Link>
      )}

      {/* Arrow — far right */}
      <div className="shrink-0 pr-3 pl-1">
        <ChevronRight className="size-3.5 text-muted-foreground/30 transition-colors group-hover:text-primary" />
      </div>
    </motion.button>
  )
}

function DateGroupHeader({ date, count }: { date: Date; count: number }) {
  const today = dateFnsIsToday(date)
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <span
        className={cn(
          'shrink-0 text-[10px] font-bold uppercase tracking-widest',
          today ? 'text-primary' : 'text-muted-foreground/70'
        )}
      >
        {today ? 'Today' : format(date, 'EEE, MMM d')}
      </span>
      <div className="h-px flex-1 bg-border/50" />
      <span className="shrink-0 text-[9px] text-muted-foreground/40 tabular-nums">
        {count}
      </span>
    </div>
  )
}

type AgendaMode = 'upcoming' | 'past'

function SessionsFeed({
  events,
  mode,
  onSelect,
  canCreate,
  activityMap,
}: {
  events: CalEvent[]
  mode: AgendaMode
  onSelect: (e: CalEvent) => void
  canCreate: boolean
  activityMap: Record<string, SessionActivitySummary>
}) {
  const grouped = useMemo(() => {
    // Use the shared bucketing helper so this list stays in sync with the
    // /classroom feed. A LIVE session is treated as upcoming for agenda
    // purposes (it's still actionable from the user's perspective).
    // Date.now() is impure but acceptable here — the memo recomputes when
    // events/mode change, which is exactly when a fresh "now" is wanted.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    const filtered = events.filter((e) => {
      const bucket = sessionBucket(
        { status: e.resource.status, scheduledStart: e.start, scheduledEnd: e.end },
        now,
      )
      return mode === 'upcoming'
        ? bucket === 'upcoming' || bucket === 'live'
        : bucket === 'past'
    })
    const sorted = [...filtered].sort((a, b) => a.start.getTime() - b.start.getTime())
    const map = new Map<string, CalEvent[]>()
    for (const e of sorted) {
      const key = format(e.start, 'yyyy-MM-dd')
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    const entries = [...map.entries()]
    return mode === 'past' ? entries.reverse() : entries
  }, [events, mode])

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50">
          <Video className="size-7 text-muted-foreground/50" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {mode === 'upcoming' ? 'No upcoming sessions' : 'No past sessions'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === 'upcoming'
              ? canCreate
                ? 'Switch to Month view and click a date to schedule one.'
                : 'Sessions scheduled by faculty will appear here.'
              : 'Once a session ends, it will appear here.'}
          </p>
        </div>
      </div>
    )
  }

  let cardIndex = 0
  return (
    <div className="space-y-6">
      {grouped.map(([dateKey, dayEvents]) => {
        const groupStart = cardIndex
        cardIndex += dayEvents.length
        return (
          <div key={dateKey} className="space-y-2">
            <DateGroupHeader date={new Date(dateKey)} count={dayEvents.length} />
            {dayEvents.map((ev, i) => (
              <SessionCard
                key={ev.id}
                event={ev}
                index={groupStart + i}
                activity={activityMap[ev.sessionId]}
                onSelect={() => onSelect(ev)}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const ORGANIZER_ROLES = ['ADMIN', 'PROGRAM_DIRECTOR', 'FACULTY']

export function CalendarView({ canCreate, userRole }: CalendarViewProps) {
  const router = useRouter()
  const [events, setEvents]             = useState<CalEvent[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [view, setView]                 = useState<View>(Views.AGENDA)
  const [date, setDate]                 = useState<Date>(new Date())
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null)
  const [activityMap, setActivityMap]   = useState<Record<string, SessionActivitySummary>>({})
  const [agendaMode, setAgendaMode]     = useState<AgendaMode>('upcoming')

  const isOrganizer = userRole ? ORGANIZER_ROLES.includes(userRole) : false

  const fetchEvents = useCallback(async (anchor: Date) => {
    setLoading(true)
    setError(null)
    try {
      const from = startOfMonth(addMonths(anchor, -1))
      const to   = endOfMonth(addMonths(anchor, 2))
      const url  = `/api/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
      const res  = await fetch(url, { credentials: 'include' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Failed to load events')
      const mapped: CalEvent[] = (json.data.events as ApiEvent[]).map((e) => ({
        id:        e.id,
        sessionId: e.sessionId,
        title:     e.title,
        start:     new Date(e.start),
        end:       new Date(e.end),
        resource:  e,
      }))
      setEvents(mapped)

      if (isOrganizer && mapped.length > 0) {
        const ids = [...new Set(mapped.map((e) => e.sessionId))].slice(0, 60).join(',')
        fetch(`/api/calendar/session-activity-batch?ids=${ids}`, { credentials: 'include' })
          .then((r) => r.json())
          .then((j) => { if (j.ok) setActivityMap(j.data.activity) })
          .catch(() => {})
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [isOrganizer])

  useEffect(() => { fetchEvents(date) }, [date, fetchEvents])

  const eventPropGetter = useCallback((_event: CalEvent) => ({ className: '' }), [])

  const onSelectEvent = useCallback(
    (event: CalEvent) => { setSelectedEvent(event) },
    []
  )

  const closePreview = useCallback(() => setSelectedEvent(null), [])

  const navigateToSession = useCallback(
    (sessionId: string) => {
      setSelectedEvent(null)
      router.push(`/classroom/${sessionId}`)
    },
    [router]
  )

  const onSelectSlot = useCallback(
    (slot: SlotInfo) => {
      if (!canCreate) return
      const params = new URLSearchParams({ start: slot.start.toISOString(), end: slot.end.toISOString() })
      router.push(`/calendar/new?${params.toString()}`)
    },
    [canCreate, router]
  )

  const components = useMemo(
    () => ({
      event: EventTile,
    }),
    []
  )

  const scrollToTime = useMemo(() => {
    const d = new Date()
    d.setHours(9, 0, 0, 0)
    return d
  }, [])

  const slotPropGetter = useCallback((date: Date) => {
    const h = date.getHours()
    if (h < 9 || h >= 18) return { className: 'rbc-off-hours' }
    return {}
  }, [])

  return (
    <>
      <SessionPreviewPanel
        event={selectedEvent}
        allEvents={events}
        onClose={closePreview}
        onNavigate={navigateToSession}
      />

      {/* Vaidix overrides for react-big-calendar */}
      <style>{`
        .rbc-calendar { font-family: inherit; }

        /* ── Month view ── */
        .rbc-header { border-bottom: 1px solid hsl(var(--border)); padding: 8px 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(var(--muted-foreground)); background: transparent; }
        .rbc-month-view { border: none; }
        .rbc-month-row { border-top: 1px solid hsl(var(--border)); }
        .rbc-day-bg { border-left: 1px solid hsl(var(--border)); }
        .rbc-day-bg.rbc-today { background: oklch(0.45 0.15 165 / 0.04); }
        .rbc-date-cell { padding: 4px 8px; font-size: 12px; font-weight: 600; color: hsl(var(--muted-foreground)); }
        .rbc-date-cell.rbc-now { color: oklch(0.45 0.15 165); font-weight: 800; }
        .rbc-date-cell.rbc-off-range { opacity: 0.35; }
        .rbc-show-more { font-size: 11px; font-weight: 700; color: oklch(0.45 0.15 165); padding: 0 4px; }
        .rbc-show-more:hover { text-decoration: underline; }

        /* ── Events ── */
        .rbc-event { background: transparent !important; border: none !important; padding: 1px 2px !important; }
        .rbc-event:focus, .rbc-event.rbc-selected { outline: none !important; box-shadow: none !important; }
        .rbc-event.rbc-selected .rounded-md { outline: 2px solid oklch(0.45 0.15 165); outline-offset: 1px; }
        /* Hide the "9:00 AM – 10:00 AM" label RBC overlays on top of our EventTile */
        .rbc-event-label { display: none !important; }

        /* ── Time grid ── */
        .rbc-toolbar { display: none; }
        .rbc-time-view { border: none; }
        .rbc-time-header { border-bottom: 1px solid hsl(var(--border)); }
        .rbc-time-content { border-top: none; }
        /* 1-hour slot groups only — clean single horizontal rule per hour */
        .rbc-timeslot-group { border-bottom: 1px solid hsl(var(--border) / 0.5); min-height: 64px; }
        .rbc-time-slot { border-top: none !important; }
        /* Vertical column separators */
        .rbc-day-slot { border-left: 1px solid hsl(var(--border) / 0.45); }
        .rbc-current-time-indicator { background: oklch(0.45 0.15 165); height: 2px; }
        /* Time-gutter labels — snap to grid line, Teams-style */
        .rbc-time-gutter .rbc-time-slot { display: flex; align-items: flex-start; justify-content: flex-end; padding-right: 10px; }
        .rbc-label { font-size: 11px; font-weight: 600; color: hsl(var(--muted-foreground)); transform: translateY(-8px); letter-spacing: 0.01em; }

        /* ── Working / off hours (Teams-style) ── */
        /* Off hours: neutral cool-gray, no brand tint */
        .rbc-off-hours { background-color: hsl(220 13% 96%) !important; }
        .rbc-off-hours .rbc-time-slot { color: hsl(var(--muted-foreground) / 0.4); }
        /* Today column: very subtle brand tint only in working hours */
        .rbc-day-slot.rbc-today { background: oklch(0.45 0.15 165 / 0.025); }
      `}</style>

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-5">
          {/* Toolbar — always visible, controls view state */}
          <CustomToolbar
            date={date}
            view={view}
            onNavigate={(action) => {
              if (action === 'TODAY') { setDate(new Date()); return }
              const dir = action === 'PREV' ? -1 : 1
              setDate((d) =>
                view === 'week' ? addWeeks(d, dir)
                : view === 'day'  ? addDays(d, dir)
                : addMonths(d, dir)
              )
            }}
            onView={setView}
            onJumpTo={setDate}
          />

          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-destructive">Could not load sessions</p>
                <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              Loading sessions…
            </div>
          )}

          {/* Sessions feed (agenda/list view) */}
          {view === Views.AGENDA ? (
            !loading && (
              <>
                <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                  {(['upcoming', 'past'] as AgendaMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAgendaMode(m)}
                      className={cn(
                        'rounded-md px-3 py-1 text-xs font-semibold capitalize transition',
                        agendaMode === m
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <SessionsFeed
                  events={events}
                  mode={agendaMode}
                  onSelect={setSelectedEvent}
                  canCreate={canCreate}
                  activityMap={activityMap}
                />
              </>
            )
          ) : (
            <>
              {/* Empty state for month view */}
              {!loading && !error && events.length === 0 && view === Views.MONTH && (
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-5 py-4">
                  <Video className="size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">No sessions this period</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {canCreate ? 'Click any date on the calendar to schedule one.' : 'Sessions scheduled by faculty will appear here.'}
                    </p>
                  </div>
                </div>
              )}

              <div className="h-120 sm:h-140 lg:h-165">
                <Calendar
                  localizer={localizer}
                  events={events}
                  view={view}
                  date={date}
                  onView={setView}
                  onNavigate={setDate}
                  views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
                  popup
                  selectable={canCreate}
                  step={60}
                  timeslots={1}
                  formats={{ timeGutterFormat: 'h a' }}
                  onSelectEvent={onSelectEvent}
                  onSelectSlot={onSelectSlot}
                  eventPropGetter={eventPropGetter}
                  slotPropGetter={slotPropGetter}
                  scrollToTime={scrollToTime}
                  components={components}
                  startAccessor="start"
                  endAccessor="end"
                  style={{ height: '100%' }}
                />
              </div>

              <Legend />
            </>
          )}
        </div>
      </div>
    </>
  )
}

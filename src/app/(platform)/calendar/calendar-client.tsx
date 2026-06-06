'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Users2, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDemoDate } from '@/components/demo/date'

// ── Real API event shape (GET /api/calendar/events → { ok, data: { events } }) ──
interface ApiEvent {
  id: string
  sessionId: string
  title: string
  start: string // ISO
  end: string // ISO
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  approvalStatus: 'DRAFT' | 'PENDING_FACULTY' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  openToAll: boolean
  sessionType: string
  host: { id: string; name: string; role: string } | null
  userRole: 'PRESENTER' | 'MODERATOR' | 'PANELIST' | 'ORGANISER' | 'ATTENDEE' | null
  isRecurring: boolean
  isOccurrence: boolean
  cohortId: string | null
  cohortName: string | null
}

// ── Demo role/colour vocabulary (decorative styling, mapped from real data) ─────
type RoleType = 'Presenter' | 'Moderator' | 'Panelist' | 'Organiser' | 'Meeting' | 'Board Room' | 'Class Room' | 'Attendee'

const ROLE_COLORS: Record<RoleType, { bg: string; text: string; dot: string }> = {
  Presenter:  { bg: 'bg-teal-500/12',   text: 'text-teal-700 dark:text-teal-300',     dot: 'bg-teal-500'   },
  Moderator:  { bg: 'bg-amber-500/12',  text: 'text-amber-700 dark:text-amber-300',   dot: 'bg-amber-500'  },
  Panelist:   { bg: 'bg-indigo-500/12', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500' },
  Organiser:  { bg: 'bg-rose-500/12',   text: 'text-rose-700 dark:text-rose-300',     dot: 'bg-rose-500'   },
  Meeting:    { bg: 'bg-sky-500/12',    text: 'text-sky-700 dark:text-sky-300',       dot: 'bg-sky-500'    },
  'Board Room':{ bg: 'bg-violet-500/12',text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  'Class Room':{ bg: 'bg-emerald-500/12',text: 'text-emerald-700 dark:text-emerald-300',dot: 'bg-emerald-500'},
  Attendee:   { bg: 'bg-slate-500/12',  text: 'text-slate-600 dark:text-slate-300',   dot: 'bg-slate-400'  },
}

// Venue-style session types: for these the badge shows the FORMAT (Meeting /
// Board Room / Class Room) when the viewer has no special role. Presentation
// types (LECTURE / GRAND_ROUNDS / CASE_CONFERENCE) are intentionally absent —
// for those a non-host viewer is an "Attendee", not the host's role.
const SESSION_TYPE_VENUE: Record<string, RoleType> = {
  JOURNAL_CLUB:    'Meeting',
  SKILLS_WORKSHOP: 'Board Room',
  ASSESSMENT:      'Class Room',
}

// Resolve the badge from the VIEWER's own role on the session — NOT the session
// type (that conflation was the "everyone shows as Presenter" bug). The service
// already resolved the viewer's standing; we just label it. A speaking badge
// (Presenter / Moderator / Panelist) only appears when it was explicitly
// assigned or earned (co-host). The owner-who-delegated is the Organiser. When
// the viewer has no standing at all (null), a venue-type session shows its
// format; everyone else is an Attendee.
function roleForViewer(userRole: ApiEvent['userRole'], sessionType: string): RoleType {
  switch (userRole) {
    case 'PRESENTER': return 'Presenter'
    case 'MODERATOR': return 'Moderator'
    case 'PANELIST':  return 'Panelist'
    case 'ORGANISER': return 'Organiser'
    case 'ATTENDEE':  return 'Attendee'
    default:          return SESSION_TYPE_VENUE[sessionType] ?? 'Attendee'
  }
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  LECTURE:         'Lecture',
  GRAND_ROUNDS:    'Grand Rounds',
  CASE_CONFERENCE: 'Case Conference',
  JOURNAL_CLUB:    'Journal Club',
  SKILLS_WORKSHOP: 'Skills Workshop',
  ASSESSMENT:      'Assessment',
}

interface CalEvent {
  id: string // calendar occurrence id (unique per render key)
  sessionId: string // real session id → links to /session/:id/pre
  title: string
  specialty?: string
  date: string // YYYY-MM-DD (local)
  time: string // HH:mm (local)
  duration: number // minutes
  role: RoleType
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function buildCalendar(year: number, month: number) {
  const first = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Convert a real ApiEvent → the demo's CalEvent shape (local date/time).
function toCalEvent(e: ApiEvent): CalEvent {
  const start = new Date(e.start)
  const end = new Date(e.end)
  const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  const time = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
  const duration = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
  return {
    id: e.id,
    sessionId: e.sessionId,
    title: e.title,
    specialty: SESSION_TYPE_LABEL[e.sessionType] ?? undefined,
    date,
    time,
    duration,
    role: roleForViewer(e.userRole, e.sessionType),
  }
}

interface CalendarClientProps {
  currentUserId: string | null
}

export function CalendarClient({ currentUserId }: CalendarClientProps) {
  const [tab, setTab] = useState<'mine' | 'org'>('mine')
  const now = useMemo(() => new Date(), [])
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selected, setSelected] = useState<string | null>(null)

  const [mine, setMine] = useState<CalEvent[]>([])
  const [org, setOrg] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch a wide window (prev month → +2 months) around the viewed month so
  // navigation feels instant. Re-fetch when the user pages far outside it.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const from = new Date(year, month - 1, 1)
        const to = new Date(year, month + 3, 0, 23, 59, 59)
        const url = `/api/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
        const res = await fetch(url, { cache: 'no-store', credentials: 'include' })
        const json = await res.json()
        if (!json.ok) throw new Error(json.error?.message ?? 'Failed to load events')
        if (cancelled) return
        const all = (json.data.events as ApiEvent[]).map((e) => ({ ...toCalEvent(e), _hostId: e.host?.id ?? null }))
        // "My Calendar" = sessions the current user hosts; "Organisational" = the rest.
        const mineList: CalEvent[] = []
        const orgList: CalEvent[] = []
        for (const ev of all) {
          const { _hostId, ...calEvent } = ev
          if (currentUserId && _hostId === currentUserId) mineList.push(calEvent)
          else orgList.push(calEvent)
        }
        // If the user hosts nothing, surface everything under "mine" so the
        // page never looks empty for residents/students.
        setMine(mineList.length > 0 ? mineList : orgList)
        setOrg(orgList)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [year, month, currentUserId])

  const events = tab === 'mine' ? mine : org
  const cells = buildCalendar(year, month)

  const eventsOnDay = (day: number) => {
    const iso = isoDate(year, month, day)
    return events.filter((e) => e.date === iso)
  }

  const selectedDayEvents = selected ? events.filter((e) => e.date === selected) : []

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  // "Upcoming" means not yet finished — drop events whose end is already in the
  // past so a session earlier this month (e.g. Jun 2 when today is Jun 6) no
  // longer shows under "Upcoming this month".
  const nowMs = now.getTime()
  const eventEndMs = (e: CalEvent) => {
    const [yy, mm, dd] = e.date.split('-').map(Number)
    const [hh, min] = e.time.split(':').map(Number)
    return new Date(yy, mm - 1, dd, hh, min).getTime() + e.duration * 60000
  }
  const upcoming = events
    .filter((e) => e.date.startsWith(monthPrefix))
    .filter((e) => eventEndMs(e) >= nowMs)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Calendar</h1>
          <p className="text-[13.5px] text-muted-foreground">Your sessions and organisational schedule in one view.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex items-center gap-1 rounded-2xl border border-border/60 bg-card p-1 w-fit">
        {(['mine', 'org'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setSelected(null) }}
            className={cn('h-9 rounded-xl px-5 text-[13px] font-medium transition-all', tab === t ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {t === 'mine' ? 'My Calendar' : 'Organisational Calendar'}
          </button>
        ))}
      </div>

      {/* Role legend */}
      {tab === 'mine' && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(Object.keys(ROLE_COLORS) as RoleType[]).map((role) => (
            <div key={role} className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', ROLE_COLORS[role].bg, ROLE_COLORS[role].text)}>
              <span className={cn('size-2 rounded-full', ROLE_COLORS[role].dot)} />
              {role}
            </div>
          ))}
        </div>
      )}

      {/* Loading / error strip */}
      {loading && (
        <div className="mb-4 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin text-teal-600" />
          Loading sessions…
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="text-[13px] font-semibold text-destructive">Could not load sessions</p>
            <p className="text-[11.5px] text-destructive/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* Calendar grid */}
        <div className="rounded-3xl border border-border/60 bg-card overflow-hidden shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
          {/* Month nav */}
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
            <button type="button" onClick={prevMonth} className="grid size-8 place-items-center rounded-full border border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-teal-600 dark:text-teal-300" />
              <span className="text-[15px] font-semibold">{MONTHS[month]} {year}</span>
            </div>
            <button type="button" onClick={nextMonth} className="grid size-8 place-items-center rounded-full border border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-border/60">
            {DAYS.map((d) => (
              <div key={d} className="py-2 text-center text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="h-20 border-b border-r border-border/30 last:border-r-0" />
              const iso = isoDate(year, month, day)
              const dayEvents = eventsOnDay(day)
              const isSelected = selected === iso
              const today = new Date()
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(isSelected ? null : iso)}
                  className={cn(
                    'relative h-20 border-b border-r border-border/30 p-1.5 text-left transition-colors hover:bg-foreground/4 last:border-r-0',
                    isSelected && 'bg-teal-500/8 ring-inset ring-1 ring-teal-500/30'
                  )}
                >
                  <div className={cn('grid size-6 place-items-center rounded-full text-[12px] font-medium', isToday ? 'bg-teal-500 text-white font-semibold' : 'text-foreground/80')}>
                    {day}
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {dayEvents.slice(0, 2).map((ev) => (
                      <div key={ev.id} className={cn('truncate rounded px-1 text-[9.5px] font-medium leading-4', ROLE_COLORS[ev.role].bg, ROLE_COLORS[ev.role].text)}>
                        {ev.title.split('—')[0].trim()}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="pl-1 text-[9px] text-muted-foreground">+{dayEvents.length - 2} more</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Day detail panel */}
        <aside className="space-y-3">
          {selected ? (
            <>
              <div className="rounded-2xl border border-border/60 bg-card px-4 py-3">
                <div className="text-[13px] font-semibold">
                  {formatDemoDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <div className="text-[11.5px] text-muted-foreground">{selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? 's' : ''}</div>
              </div>
              {selectedDayEvents.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] py-8 text-center text-[12.5px] text-muted-foreground">
                  No events on this day
                </div>
              )}
              {selectedDayEvents.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/session/${ev.sessionId}/pre`}
                  className={cn('block rounded-2xl border p-3.5 transition-all hover:opacity-90', ROLE_COLORS[ev.role].bg)}
                >
                  <div className={cn('flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wider uppercase', ROLE_COLORS[ev.role].text)}>
                    <span className={cn('size-2 rounded-full', ROLE_COLORS[ev.role].dot)} />
                    {ev.role}
                  </div>
                  <div className="mt-1.5 text-[13.5px] font-semibold leading-snug">{ev.title}</div>
                  {ev.specialty && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{ev.specialty}</div>}
                  <div className="mt-2 flex items-center gap-3 text-[11.5px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock3 className="size-3" />{ev.time}</span>
                    <span>{ev.duration} min</span>
                  </div>
                </Link>
              ))}
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-border/60 bg-card px-4 py-3">
                <div className="text-[13px] font-semibold">Upcoming this month</div>
                <div className="text-[11.5px] text-muted-foreground">{upcoming.length} events</div>
              </div>
              {upcoming.slice(0, 6).map((ev) => (
                <Link
                  key={ev.id}
                  href={`/session/${ev.sessionId}/pre`}
                  className={cn('block w-full rounded-2xl border p-3 text-left transition-all hover:opacity-90', ROLE_COLORS[ev.role].bg)}
                >
                  <div className={cn('flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase', ROLE_COLORS[ev.role].text)}>
                    <span className={cn('size-1.5 rounded-full', ROLE_COLORS[ev.role].dot)} />
                    {ev.role}
                  </div>
                  <div className="mt-1 text-[12.5px] font-semibold leading-snug">{ev.title.split('—')[0].trim()}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <CalendarDays className="size-3" />
                    {formatDemoDate(ev.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                    <Clock3 className="size-3" />{ev.time}
                  </div>
                </Link>
              ))}
              {!loading && upcoming.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] py-8 text-center text-[12.5px] text-muted-foreground">
                  No events this month
                </div>
              )}
            </>
          )}

          {/* Org legend for org tab */}
          {tab === 'org' && (
            <div className="rounded-2xl border border-border/60 bg-card p-3.5">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold"><Users2 className="size-4 text-muted-foreground" />Organisational events</div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">Exams, grand rounds, journal clubs, and departmental events visible to all faculty.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

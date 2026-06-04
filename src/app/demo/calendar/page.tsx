'use client'

import { useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Users2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDemoDate } from '@/components/demo/date'

type RoleType = 'Presenter' | 'Moderator' | 'Panelist' | 'Meeting' | 'Board Room' | 'Class Room'

const ROLE_COLORS: Record<RoleType, { bg: string; text: string; dot: string }> = {
  Presenter:  { bg: 'bg-teal-500/12',   text: 'text-teal-700 dark:text-teal-300',     dot: 'bg-teal-500'   },
  Moderator:  { bg: 'bg-amber-500/12',  text: 'text-amber-700 dark:text-amber-300',   dot: 'bg-amber-500'  },
  Panelist:   { bg: 'bg-indigo-500/12', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500' },
  Meeting:    { bg: 'bg-sky-500/12',    text: 'text-sky-700 dark:text-sky-300',       dot: 'bg-sky-500'    },
  'Board Room':{ bg: 'bg-violet-500/12',text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  'Class Room':{ bg: 'bg-emerald-500/12',text: 'text-emerald-700 dark:text-emerald-300',dot: 'bg-emerald-500'},
}

interface CalEvent {
  id: string
  title: string
  specialty?: string
  date: string   // YYYY-MM-DD
  time: string
  duration: number
  role: RoleType
}

const MY_EVENTS: CalEvent[] = [
  { id: 'e1',  title: 'Diabetic Retinopathy — Staging & Management', specialty: 'Vitreoretina', date: '2026-05-28', time: '17:30', duration: 60, role: 'Presenter' },
  { id: 'e2',  title: 'Anterior Uveitis — Differential Diagnosis',   specialty: 'Uvea',          date: '2026-05-30', time: '15:00', duration: 45, role: 'Presenter' },
  { id: 'e3',  title: 'Cataract Surgical Planning',                  specialty: 'Cataract & IOL', date: '2026-06-02', time: '11:00', duration: 90, role: 'Presenter' },
  { id: 'e4',  title: 'Retinal Imaging Grand Rounds',                specialty: 'Imaging',        date: '2026-06-04', time: '16:00', duration: 60, role: 'Moderator' },
  { id: 'e5',  title: 'Cornea Symposium — Panel Discussion',         specialty: 'Cornea',         date: '2026-06-07', time: '10:00', duration: 120, role: 'Panelist' },
  { id: 'e6',  title: 'Faculty Meeting — Q2 Review',                                              date: '2026-06-03', time: '09:00', duration: 60, role: 'Meeting' },
  { id: 'e7',  title: 'IOL Case Discussion',                         specialty: 'Cataract & IOL', date: '2026-06-05', time: '13:00', duration: 30, role: 'Board Room' },
  { id: 'e8',  title: 'Glaucoma — When to Treat',                   specialty: 'Glaucoma',       date: '2026-06-10', time: '15:30', duration: 60, role: 'Class Room' },
  { id: 'e9',  title: 'Refractive Surgery Workshop',                specialty: 'Refractive',     date: '2026-06-12', time: '09:00', duration: 180, role: 'Presenter' },
]

const ORG_EVENTS: CalEvent[] = [
  { id: 'o1', title: 'LVPEI Grand Rounds — All Faculty',  date: '2026-06-01', time: '08:00', duration: 90, role: 'Meeting' },
  { id: 'o2', title: 'DNB Theory Exam — Batch 2024',     date: '2026-06-06', time: '09:00', duration: 180, role: 'Class Room' },
  { id: 'o3', title: 'Research Journal Club',            date: '2026-06-08', time: '17:00', duration: 60, role: 'Meeting' },
  { id: 'o4', title: 'Fellowship Batch A — Final Viva',  date: '2026-06-11', time: '10:00', duration: 120, role: 'Class Room' },
  { id: 'o5', title: 'Departmental Annual Review',       date: '2026-06-15', time: '14:00', duration: 90, role: 'Meeting' },
  { id: 'o6', title: 'Wet Lab — Phacoemulsification',    date: '2026-06-17', time: '07:30', duration: 240, role: 'Class Room' },
]

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

export default function CalendarPage() {
  const [tab, setTab] = useState<'mine' | 'org'>('mine')
  const [year, setYear] = useState(2026)
  const [month, setMonth] = useState(4) // May = 4
  const [selected, setSelected] = useState<string | null>(null)

  const events = tab === 'mine' ? MY_EVENTS : ORG_EVENTS
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
                <div key={ev.id} className={cn('rounded-2xl border p-3.5 transition-all', ROLE_COLORS[ev.role].bg)}>
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
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-border/60 bg-card px-4 py-3">
                <div className="text-[13px] font-semibold">Upcoming this month</div>
                <div className="text-[11.5px] text-muted-foreground">{events.filter((e) => e.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).length} events</div>
              </div>
              {events
                .filter((e) => e.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(0, 6)
                .map((ev) => (
                  <button key={ev.id} type="button" onClick={() => setSelected(ev.date)} className={cn('w-full rounded-2xl border p-3 text-left transition-all hover:opacity-90', ROLE_COLORS[ev.role].bg)}>
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
                  </button>
                ))}
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

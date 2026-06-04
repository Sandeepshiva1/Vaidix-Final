'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Filter,
  LayoutGrid,
  List,
  Search,
  TrendingUp,
  Trophy,
  Users2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Learner {
  id: string
  name: string
  initials: string
  specialty: string
  subSpecialty: string
  batch: string
  score: number
  attendance: number
  quizzes: number
  sessions: number
  trend: 'up' | 'down' | 'flat'
}

const LEARNERS: Learner[] = [
  { id: 'l1',  name: 'Priya Sharma',       initials: 'PS', specialty: 'Vitreoretina',   subSpecialty: 'Medical Retina',        batch: 'DNB 2024',     score: 88, attendance: 92, quizzes: 12, sessions: 8,  trend: 'up'   },
  { id: 'l2',  name: 'Karthik Reddy',      initials: 'KR', specialty: 'Cornea',         subSpecialty: 'Keratoconus',           batch: 'DNB 2024',     score: 74, attendance: 85, quizzes: 10, sessions: 7,  trend: 'flat' },
  { id: 'l3',  name: 'Ananya Nair',        initials: 'AN', specialty: 'Glaucoma',       subSpecialty: 'Primary Open Angle',    batch: 'Fellowship A', score: 91, attendance: 100,quizzes: 14, sessions: 9,  trend: 'up'   },
  { id: 'l4',  name: 'Rohit Mishra',       initials: 'RM', specialty: 'Uvea',           subSpecialty: 'Anterior Uveitis',      batch: 'DNB 2023',     score: 63, attendance: 78, quizzes: 8,  sessions: 6,  trend: 'down' },
  { id: 'l5',  name: 'Deepika Rao',        initials: 'DR', specialty: 'Vitreoretina',   subSpecialty: 'Diabetic Retinopathy',  batch: 'Fellowship A', score: 82, attendance: 95, quizzes: 13, sessions: 9,  trend: 'up'   },
  { id: 'l6',  name: 'Arun Krishnamurthy', initials: 'AK', specialty: 'Cataract & IOL', subSpecialty: 'Phacoemulsification',   batch: 'DNB 2024',     score: 79, attendance: 88, quizzes: 11, sessions: 8,  trend: 'flat' },
  { id: 'l7',  name: 'Supriya Patel',      initials: 'SP', specialty: 'Oculoplasty',    subSpecialty: 'Eyelid Surgery',        batch: 'Fellowship B', score: 85, attendance: 90, quizzes: 12, sessions: 8,  trend: 'up'   },
  { id: 'l8',  name: 'Vijay Menon',        initials: 'VM', specialty: 'Imaging',        subSpecialty: 'OCT',                   batch: 'DNB 2023',     score: 70, attendance: 82, quizzes: 9,  sessions: 7,  trend: 'down' },
  { id: 'l9',  name: 'Neha Gupta',         initials: 'NG', specialty: 'Cornea',         subSpecialty: 'Ocular Surface',        batch: 'Fellowship A', score: 93, attendance: 97, quizzes: 15, sessions: 10, trend: 'up'   },
  { id: 'l10', name: 'Sanjay Kumar',       initials: 'SK', specialty: 'Glaucoma',       subSpecialty: 'Surgical Glaucoma',     batch: 'DNB 2024',     score: 67, attendance: 80, quizzes: 9,  sessions: 6,  trend: 'flat' },
  { id: 'l11', name: 'Ritu Bansal',        initials: 'RB', specialty: 'Cataract & IOL', subSpecialty: 'Premium IOLs',          batch: 'Fellowship B', score: 76, attendance: 86, quizzes: 11, sessions: 8,  trend: 'up'   },
  { id: 'l12', name: 'Mohan Prasad',       initials: 'MP', specialty: 'Uvea',           subSpecialty: 'Panuveitis',            batch: 'DNB 2023',     score: 59, attendance: 73, quizzes: 7,  sessions: 5,  trend: 'down' },
]

const BATCHES = ['All', 'DNB 2024', 'DNB 2023', 'Fellowship A', 'Fellowship B']
const SPECIALTIES = ['All', 'Vitreoretina', 'Cornea', 'Glaucoma', 'Uvea', 'Cataract & IOL', 'Oculoplasty', 'Imaging']
const SORT_OPTIONS = ['Alphabetical', 'Score (high→low)', 'Attendance (high→low)', 'Score (low→high)'] as const
type SortOption = (typeof SORT_OPTIONS)[number]

const TREND_ICON = {
  up:   <TrendingUp className="size-3.5 text-emerald-500" />,
  down: <TrendingUp className="size-3.5 rotate-180 text-rose-500" />,
  flat: <span className="inline-block h-0.5 w-3.5 rounded-full bg-muted-foreground/50" />,
}

const SCORE_COLOR = (s: number) =>
  s >= 80 ? 'text-emerald-700 dark:text-emerald-300' : s >= 65 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'

export default function ActiveLearnersPage() {
  const [search, setSearch] = useState('')
  const [batch, setBatch] = useState('All')
  const [specialty, setSpecialty] = useState('All')
  const [sort, setSort] = useState<SortOption>('Alphabetical')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Learner | null>(null)

  const filtered = useMemo(() => {
    let list = LEARNERS.filter((l) => {
      if (batch !== 'All' && l.batch !== batch) return false
      if (specialty !== 'All' && l.specialty !== specialty) return false
      if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.specialty.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    if (sort === 'Alphabetical') list = list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'Score (high→low)') list = list.sort((a, b) => b.score - a.score)
    if (sort === 'Score (low→high)') list = list.sort((a, b) => a.score - b.score)
    if (sort === 'Attendance (high→low)') list = list.sort((a, b) => b.attendance - a.attendance)
    return list
  }, [search, batch, specialty, sort])

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Active Learners</h1>
          <p className="text-[13.5px] text-muted-foreground">
            {LEARNERS.length} learners across {BATCHES.length - 1} batches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setView('grid')} className={cn('grid size-9 place-items-center rounded-xl border transition-colors', view === 'grid' ? 'border-teal-500/50 bg-teal-500/8 text-teal-700 dark:text-teal-300' : 'border-border/60 text-muted-foreground hover:bg-foreground/5')}>
            <LayoutGrid className="size-4" />
          </button>
          <button type="button" onClick={() => setView('list')} className={cn('grid size-9 place-items-center rounded-xl border transition-colors', view === 'list' ? 'border-teal-500/50 bg-teal-500/8 text-teal-700 dark:text-teal-300' : 'border-border/60 text-muted-foreground hover:bg-foreground/5')}>
            <List className="size-4" />
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { icon: <Users2 className="size-4" />, label: 'Total learners', value: `${LEARNERS.length}` },
          { icon: <Trophy className="size-4" />, label: 'Avg. score', value: `${Math.round(LEARNERS.reduce((a, l) => a + l.score, 0) / LEARNERS.length)}%` },
          { icon: <BarChart3 className="size-4" />, label: 'Avg. attendance', value: `${Math.round(LEARNERS.reduce((a, l) => a + l.attendance, 0) / LEARNERS.length)}%` },
          { icon: <BookOpen className="size-4" />, label: 'Quizzes completed', value: `${LEARNERS.reduce((a, l) => a + l.quizzes, 0)}` },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">{s.icon}{s.label}</div>
            <div className="mt-1 font-mono text-[22px] font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card p-2">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-background/60 px-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or specialty…" className="h-full flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70" />
        </div>
        <FilterSelect label="Batch" value={batch} options={BATCHES} onChange={setBatch} />
        <FilterSelect label="Specialty" value={specialty} options={SPECIALTIES} onChange={setSpecialty} />
        <FilterSelect label="Sort" value={sort} options={[...SORT_OPTIONS]} onChange={(v) => setSort(v as SortOption)} />
        <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
          <Filter className="size-3.5" />
          <span>{filtered.length} shown</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Learner grid / list */}
        <div>
          {view === 'grid' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
              {filtered.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelected(l)}
                  className={cn('group rounded-3xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-teal-500/40 hover:shadow-[0_8px_30px_-15px_oklch(0.45_0.15_165/0.25)]', selected?.id === l.id ? 'border-teal-500/50 ring-1 ring-teal-500/20' : 'border-border/60')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="grid size-10 place-items-center rounded-full bg-linear-to-br from-teal-500/20 to-emerald-500/15 text-[13px] font-semibold text-teal-700 dark:text-teal-300">
                      {l.initials}
                    </div>
                    <div className="flex items-center gap-1">{TREND_ICON[l.trend]}</div>
                  </div>
                  <div className="mt-2.5 leading-tight">
                    <div className="text-[13.5px] font-semibold">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground">{l.specialty}</div>
                    <div className="text-[10.5px] text-muted-foreground">{l.batch}</div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-foreground/[0.025] px-2 py-1.5">
                      <div className="text-muted-foreground">Score</div>
                      <div className={cn('font-mono text-[14px] font-semibold tabular-nums', SCORE_COLOR(l.score))}>{l.score}%</div>
                    </div>
                    <div className="rounded-lg bg-foreground/[0.025] px-2 py-1.5">
                      <div className="text-muted-foreground">Attendance</div>
                      <div className="font-mono text-[14px] font-semibold tabular-nums">{l.attendance}%</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-border/60 bg-card">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {['Learner', 'Specialty', 'Batch', 'Score', 'Attendance', 'Quizzes', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} onClick={() => setSelected(l)} className={cn('cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-foreground/4', selected?.id === l.id && 'bg-teal-500/5')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500/20 to-emerald-500/15 text-[11px] font-semibold text-teal-700 dark:text-teal-300">{l.initials}</div>
                          <div>
                            <div className="font-semibold">{l.name}</div>
                            <div className="text-[10.5px] text-muted-foreground">{l.subSpecialty}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{l.specialty}</td>
                      <td className="px-4 py-3 text-muted-foreground">{l.batch}</td>
                      <td className="px-4 py-3"><span className={cn('font-mono font-semibold', SCORE_COLOR(l.score))}>{l.score}%</span></td>
                      <td className="px-4 py-3 font-mono font-medium">{l.attendance}%</td>
                      <td className="px-4 py-3 font-mono">{l.quizzes}</td>
                      <td className="px-4 py-3">{TREND_ICON[l.trend]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Learner detail panel */}
        {selected && (
          <aside className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid size-14 place-items-center rounded-full bg-linear-to-br from-teal-500/20 to-emerald-500/15 text-[17px] font-semibold text-teal-700 dark:text-teal-300">
                  {selected.initials}
                </div>
                <div>
                  <div className="text-[16px] font-semibold">{selected.name}</div>
                  <div className="text-[12px] text-muted-foreground">{selected.specialty} · {selected.subSpecialty}</div>
                  <div className="text-[11px] text-muted-foreground">{selected.batch}</div>
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">×</button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {[
                { label: 'Score', value: `${selected.score}%`, color: SCORE_COLOR(selected.score) },
                { label: 'Attendance', value: `${selected.attendance}%`, color: 'text-foreground' },
                { label: 'Quizzes done', value: selected.quizzes.toString(), color: 'text-foreground' },
                { label: 'Sessions', value: selected.sessions.toString(), color: 'text-foreground' },
              ].map((m) => (
                <div key={m.label} className="rounded-2xl border border-border/60 bg-background/60 p-3">
                  <div className="text-[10.5px] font-medium text-muted-foreground">{m.label}</div>
                  <div className={cn('mt-0.5 font-mono text-[22px] font-semibold tabular-nums', m.color)}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Score bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="font-medium text-muted-foreground">Performance trend</span>
                <div className="flex items-center gap-1">{TREND_ICON[selected.trend]}<span className="capitalize text-muted-foreground">{selected.trend}</span></div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/5">
                <div className={cn('h-full rounded-full', selected.score >= 80 ? 'bg-linear-to-r from-emerald-500 to-teal-500' : selected.score >= 65 ? 'bg-linear-to-r from-amber-400 to-amber-500' : 'bg-linear-to-r from-rose-400 to-rose-500')} style={{ width: `${selected.score}%` }} />
              </div>
            </div>

            {/* Strong / weak */}
            <div className="mt-4 space-y-2">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-50/60 p-3 dark:bg-emerald-500/8">
                <div className="mb-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Strong areas</div>
                <div className="text-[12px] text-foreground/80">OCT interpretation, Case staging, Imaging protocols</div>
              </div>
              <div className="rounded-2xl border border-rose-500/20 bg-rose-50/60 p-3 dark:bg-rose-500/8">
                <div className="mb-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">Needs improvement</div>
                <div className="text-[12px] text-foreground/80">Anti-VEGF dosing protocols, PRP indications</div>
              </div>
            </div>

            <Link href="/demo" className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-border/60 bg-background/60 px-4 py-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
              Full analytics profile
              <ArrowUpRight className="size-3.5" />
            </Link>
          </aside>
        )}
      </div>
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 appearance-none rounded-xl border border-border/60 bg-background/60 pl-3 pr-7 text-[12px] font-medium text-foreground outline-none transition-colors hover:bg-foreground/5">
        {options.map((o) => <option key={o} value={o}>{o === 'All' ? `All ${label}s` : o}</option>)}
      </select>
      <svg className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </div>
  )
}

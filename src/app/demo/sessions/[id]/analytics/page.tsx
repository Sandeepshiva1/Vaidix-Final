'use client'

import { notFound, useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Flame,
  HelpCircle,
  Medal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users2,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDemoState } from '@/components/demo/demo-state'
import { SessionHeader } from '@/components/demo/session-header'

// ─── Mock data ────────────────────────────────────────────────────────────────
const PREREAD_STATS = [
  { file: 'SUN Working Group — Uveitis nomenclature.pdf', opens: 38, total: 62, pct: 61 },
  { file: 'Anterior Uveitis — Quick reference.pdf',       opens: 44, total: 62, pct: 71 },
]

const QUIZ_STATS = {
  participated: 54,
  total: 62,
  avgScore: 67,
  strongTopics: ['Anatomical classification', 'Slit-lamp findings', 'HLA-B27 associations'],
  weakTopics:   ['Granulomatous vs non-granulomatous', 'Treatment ladders', 'Systemic workup'],
  completionByDay: [12, 24, 36, 44, 49, 54],
}

const LEADERBOARD = [
  { rank: 1,  name: 'Ananya Nair',        batch: 'Fellowship A', score: 96, streak: 6 },
  { rank: 2,  name: 'Neha Gupta',         batch: 'Fellowship A', score: 93, streak: 5 },
  { rank: 3,  name: 'Priya Sharma',       batch: 'DNB 2024',     score: 88, streak: 4 },
  { rank: 4,  name: 'Deepika Rao',        batch: 'Fellowship A', score: 85, streak: 4 },
  { rank: 5,  name: 'Arun Krishnamurthy', batch: 'DNB 2024',     score: 79, streak: 3 },
  { rank: 6,  name: 'Ravi Menon',         batch: 'Fellowship B', score: 74, streak: 2 },
  { rank: 7,  name: 'Kavitha Reddy',      batch: 'DNB 2024',     score: 71, streak: 2 },
  { rank: 8,  name: 'Suresh Patel',       batch: 'Fellowship B', score: 68, streak: 1 },
  { rank: 9,  name: 'Meena Iyer',         batch: 'DNB 2024',     score: 64, streak: 1 },
  { rank: 10, name: 'Ajay Nambiar',       batch: 'Fellowship A', score: 61, streak: 0 },
  { rank: 11, name: 'Pooja Singh',        batch: 'Fellowship B', score: 58, streak: 0 },
  { rank: 12, name: 'Rajesh Kumar',       batch: 'DNB 2024',     score: 54, streak: 1 },
  { rank: 13, name: 'Divya Menon',        batch: 'Fellowship A', score: 51, streak: 0 },
  { rank: 14, name: 'Kiran Reddy',        batch: 'DNB 2024',     score: 48, streak: 0 },
  { rank: 15, name: 'Sunita Joshi',       batch: 'Fellowship B', score: 45, streak: 0 },
  { rank: 16, name: 'Manoj Verma',        batch: 'DNB 2024',     score: 41, streak: 0 },
  { rank: 17, name: 'Asha Thomas',        batch: 'Fellowship A', score: 38, streak: 0 },
  { rank: 18, name: 'Vikram Sahu',        batch: 'DNB 2024',     score: 34, streak: 0 },
]

const MCQ_BREAKDOWN = [
  { q: 'Anterior uveitis — commonest cause worldwide?', pct: 82, correct: true },
  { q: 'HLA-B27 positive rate in ankylosing spondylitis uveitis?', pct: 58, correct: false },
  { q: 'First-line topical for anterior uveitis?', pct: 91, correct: true },
  { q: 'Granulomatous sign on slit lamp?', pct: 44, correct: false },
  { q: 'Workup for bilateral granulomatous uveitis?', pct: 38, correct: false },
]

const ENGAGEMENT_HEAT = [
  { label: 'Watched intro video', pct: 78 },
  { label: 'Read preread 1 fully', pct: 61 },
  { label: 'Read preread 2 fully', pct: 49 },
  { label: 'Completed quiz', pct: 87 },
  { label: 'Asked a question', pct: 35 },
  { label: 'Upvoted a peer answer', pct: 28 },
]

const COHORT_SEGMENTS = [
  { label: 'Critical',      count: 8,  color: 'bg-rose-500',   text: 'text-rose-700 dark:text-rose-300',     dot: 'bg-rose-500' },
  { label: 'At Risk',       count: 12, color: 'bg-amber-500',  text: 'text-amber-700 dark:text-amber-300',   dot: 'bg-amber-500' },
  { label: 'Progressing',   count: 22, color: 'bg-sky-500',    text: 'text-sky-700 dark:text-sky-300',       dot: 'bg-sky-500' },
  { label: 'Session Ready', count: 31, color: 'bg-emerald-500',text: 'text-emerald-700 dark:text-emerald-300',dot: 'bg-emerald-500' },
]
const COHORT_TOTAL = 73

const DAILY_ENGAGEMENT = [
  { day: 'Mon', full: 18, partial: 12, loggedIn: 8 },
  { day: 'Tue', full: 22, partial: 14, loggedIn: 7 },
  { day: 'Wed', full: 31, partial: 16, loggedIn: 6 },
  { day: 'Thu', full: 28, partial: 11, loggedIn: 9 },
  { day: 'Fri', full: 35, partial: 10, loggedIn: 5 },
  { day: 'Sat', full: 15, partial: 8,  loggedIn: 4 },
  { day: 'Sun', full: 12, partial: 6,  loggedIn: 3 },
]
const MAX_DAILY = 53

const AI_INSIGHTS = [
  {
    color: 'rose' as const,
    icon: <AlertTriangle className="size-4" />,
    title: '8 learners critically unprepared',
    body: 'These learners have opened less than 25% of prereads and scored below 40% on the quiz. Consider a direct nudge before the session.',
  },
  {
    color: 'amber' as const,
    icon: <Zap className="size-4" />,
    title: 'Immunosuppression topic gap identified',
    body: '58% answered the immunosuppression question incorrectly. Allocate the first 10 minutes to this concept — it will have the highest ROI.',
  },
  {
    color: 'emerald' as const,
    icon: <TrendingUp className="size-4" />,
    title: 'Strong cohort momentum',
    body: 'Engagement has increased 34% over the past 3 days. This cohort is on track for the highest readiness score in 6 sessions.',
  },
]

const RANK_MEDAL: Record<number, React.ReactNode> = {
  1: <Medal className="size-5 text-amber-400" />,
  2: <Medal className="size-5 text-slate-400" />,
  3: <Medal className="size-5 text-amber-700 dark:text-amber-600" />,
}

export default function AnalyticsPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()
  const { getSession, markStep } = useDemoState()
  const session = id ? getSession(id) : undefined

  const [activeTab, setActiveTab] = useState<'overview' | 'quiz' | 'leaderboard' | 'engagement'>('overview')
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null)

  if (!session) {
    if (typeof window !== 'undefined') return null
    return notFound()
  }

  const finalize = () => {
    markStep(session.id, 'analytics', true)
    router.push(`/demo/sessions/${session.id}/prepare`)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <SessionHeader session={session} backHref={`/demo/sessions/${session.id}/prepare`} eyebrow="Step 4 · Responses & Analytics" />

      {/* Top stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<BookOpen className="size-4" />}  label="Preread opens"      value="38" sub="of 62 learners" accent={false} />
        <StatCard icon={<HelpCircle className="size-4" />} label="Quiz participants"  value="54" sub={`${Math.round(54/62*100)}% of cohort`} accent={false} />
        <StatCard icon={<Target className="size-4" />}    label="Avg. quiz score"    value="67%" sub="3 weak topics" accent />
        <StatCard icon={<Users2 className="size-4" />}    label="Fully prepared"     value="29" sub="completed all steps" accent={false} />
      </div>

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-1 rounded-2xl border border-border/60 bg-card p-1 w-fit">
        {(['overview', 'quiz', 'leaderboard', 'engagement'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setActiveTab(t)} className={cn('h-9 rounded-xl px-4 text-[12.5px] font-medium capitalize transition-all', activeTab === t ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Risk KPI strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-300"><AlertTriangle className="size-3.5" />At-Risk</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-rose-700 dark:text-rose-300">12</div>
              <div className="text-[10.5px] text-muted-foreground">of {COHORT_TOTAL} learners</div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"><Zap className="size-3.5" />Non-Engaged</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-amber-700 dark:text-amber-300">8</div>
              <div className="text-[10.5px] text-muted-foreground">&lt; 25% activity</div>
            </div>
            <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-teal-700 dark:text-teal-300"><Target className="size-3.5" />Avg Readiness</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-teal-700 dark:text-teal-300">67</div>
              <div className="text-[10.5px] text-muted-foreground">out of 100</div>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3.5" />Session-Ready</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">31</div>
              <div className="text-[10.5px] text-muted-foreground">of {COHORT_TOTAL} learners</div>
            </div>
          </div>

          {/* Existing 2-col grid */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Preread opens */}
            <section className="rounded-3xl border border-border/60 bg-card p-5">
              <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
                <BookOpen className="size-4 text-teal-600 dark:text-teal-300" />
                Preread Opens
              </div>
              <div className="space-y-3">
                {PREREAD_STATS.map((p) => (
                  <div key={p.file}>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="truncate font-medium text-foreground/85 pr-3">{p.file.split('—')[0].trim()}</span>
                      <span className="shrink-0 font-mono font-semibold tabular-nums">{p.opens}/{p.total}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/5">
                      <div className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500" style={{ width: `${p.pct}%` }} />
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground">{p.pct}% opened</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Strong / weak topics */}
            <section className="rounded-3xl border border-border/60 bg-card p-5">
              <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
                <BarChart3 className="size-4 text-teal-600 dark:text-teal-300" />
                Topic Readiness
              </div>
              <div className="mb-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <TrendingUp className="size-3.5" /> Strong topics
                </div>
                <ul className="space-y-1.5">
                  {QUIZ_STATS.strongTopics.map((t) => (
                    <li key={t} className="flex items-center gap-2 rounded-xl bg-emerald-50/80 px-3 py-1.5 text-[12px] font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <CheckCircle2 className="size-3.5 shrink-0" />{t}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                  <TrendingDown className="size-3.5" /> Weak topics — address these first
                </div>
                <ul className="space-y-1.5">
                  {QUIZ_STATS.weakTopics.map((t) => (
                    <li key={t} className="flex items-center gap-2 rounded-xl bg-rose-50/80 px-3 py-1.5 text-[12px] font-medium text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
                      <span className="size-3.5 shrink-0 rounded-full border-2 border-rose-400" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

          </div>

          {/* Cohort Readiness Distribution */}
          <section className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <Users2 className="size-4 text-teal-600 dark:text-teal-300" />
              Cohort Readiness Distribution
              <span className="ml-auto text-[11.5px] font-normal text-muted-foreground">{COHORT_TOTAL} learners total</span>
            </div>
            <div className="flex h-9 overflow-hidden rounded-xl">
              {COHORT_SEGMENTS.map((seg) => (
                <div
                  key={seg.label}
                  className={cn('flex items-center justify-center text-[11px] font-bold text-white transition-all', seg.color)}
                  style={{ width: `${(seg.count / COHORT_TOTAL) * 100}%` }}
                >
                  {seg.count}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {COHORT_SEGMENTS.map((seg) => (
                <div key={seg.label} className="flex items-center gap-1.5 text-[11.5px]">
                  <span className={cn('size-2.5 shrink-0 rounded-full', seg.dot)} />
                  <span className={cn('font-semibold', seg.text)}>{seg.count}</span>
                  <span className="text-muted-foreground">{seg.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Daily Engagement */}
          <section className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <BarChart3 className="size-4 text-teal-600 dark:text-teal-300" />
              Daily Engagement — Last 7 Days
            </div>
            <div className="flex items-end gap-2" style={{ height: '96px' }}>
              {DAILY_ENGAGEMENT.map((d, i) => {
                const total = d.full + d.partial + d.loggedIn
                const barH = Math.round((total / MAX_DAILY) * 80)
                const fullH = Math.round((d.full / total) * barH)
                const partH = Math.round((d.partial / total) * barH)
                const loginH = barH - fullH - partH
                const isHovered = hoveredDayIdx === i
                return (
                  <div
                    key={d.day}
                    className="relative flex flex-1 flex-col items-center gap-1"
                    onMouseEnter={() => setHoveredDayIdx(i)}
                    onMouseLeave={() => setHoveredDayIdx(null)}
                  >
                    {isHovered && (
                      <div className="absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border/60 bg-popover px-2 py-1 text-[10.5px] font-semibold shadow-md">
                        {total} students
                      </div>
                    )}
                    <div className={cn('relative w-full overflow-hidden rounded-t-md transition-opacity', isHovered ? 'opacity-100' : 'opacity-90')} style={{ height: `${barH}px` }}>
                      <div className="absolute bottom-0 w-full bg-teal-200 dark:bg-teal-900" style={{ height: `${loginH}px` }} />
                      <div className="absolute w-full bg-teal-400 dark:bg-teal-600" style={{ bottom: `${loginH}px`, height: `${partH}px` }} />
                      <div className="absolute w-full bg-teal-600 dark:bg-teal-400" style={{ bottom: `${loginH + partH}px`, height: `${fullH}px` }} />
                    </div>
                    <div className="text-[9.5px] text-muted-foreground">{d.day}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-teal-600 dark:bg-teal-400" />Full engagement</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-teal-400 dark:bg-teal-600" />Partial</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-teal-200 dark:bg-teal-900" />Logged in only</span>
            </div>
          </section>

          {/* AI Insights */}
          <section className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <Sparkles className="size-4 text-teal-600 dark:text-teal-300" />
              AI Insights
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {AI_INSIGHTS.map((ins) => {
                const styles = {
                  rose:    { wrap: 'border-rose-500/20 bg-rose-500/5',    icon: 'text-rose-700 dark:text-rose-300',    title: 'text-rose-800 dark:text-rose-200' },
                  amber:   { wrap: 'border-amber-500/20 bg-amber-500/5',  icon: 'text-amber-700 dark:text-amber-300',  title: 'text-amber-800 dark:text-amber-200' },
                  emerald: { wrap: 'border-emerald-500/20 bg-emerald-500/5', icon: 'text-emerald-700 dark:text-emerald-300', title: 'text-emerald-800 dark:text-emerald-200' },
                }[ins.color]
                return (
                  <div key={ins.title} className={cn('rounded-2xl border p-4', styles.wrap)}>
                    <div className={cn('flex items-center gap-2 text-[12.5px] font-semibold', styles.icon)}>
                      {ins.icon}
                      <span className={styles.title}>{ins.title}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-snug text-foreground/80">{ins.body}</p>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'quiz' && (
        <div className="space-y-3">
          <div className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[13.5px] font-semibold">MCQ Breakdown</div>
              <div className="text-[12px] text-muted-foreground">% answered correctly</div>
            </div>
            <div className="space-y-3">
              {MCQ_BREAKDOWN.map((m, i) => (
                <div key={i} className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
                  <div className="flex items-start gap-2">
                    <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-[10.5px] font-semibold', m.correct ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300')}>Q{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium leading-snug">{m.q}</p>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/5">
                          <div className={cn('h-full rounded-full', m.pct >= 70 ? 'bg-linear-to-r from-emerald-500 to-teal-500' : m.pct >= 50 ? 'bg-linear-to-r from-amber-400 to-amber-500' : 'bg-linear-to-r from-rose-400 to-rose-500')} style={{ width: `${m.pct}%` }} />
                        </div>
                        <span className={cn('w-10 shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums', m.pct >= 70 ? 'text-emerald-700 dark:text-emerald-300' : m.pct >= 50 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300')}>{m.pct}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-teal-500/20 bg-linear-to-br from-teal-500/8 via-transparent to-emerald-500/8 p-5">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300" />
              <div>
                <div className="text-[13px] font-semibold">Vaidix recommendation</div>
                <p className="mt-1 text-[12.5px] leading-snug text-foreground/85">
                  Lead your session with granulomatous vs non-granulomatous differentiation — only 44% of learners got this right. Consider a rapid slit-lamp pattern-matching exercise in the first 10 minutes.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div className="rounded-3xl border border-border/60 bg-card overflow-hidden">
          <div className="border-b border-border/60 px-5 py-4">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              <Trophy className="size-4 text-amber-500" />
              All Learners
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Ranked by preread quiz performance + attendance streak · {LEADERBOARD.length} learners</p>
          </div>
          <ul className="divide-y divide-border/40">
            {LEADERBOARD.map((l) => (
              <li key={l.rank} className={cn('flex items-center gap-4 px-5 py-4 transition-colors hover:bg-foreground/3', l.rank <= 3 && 'bg-amber-50/40 dark:bg-amber-500/5')}>
                <div className="w-7 shrink-0 text-center">
                  {RANK_MEDAL[l.rank] ?? <span className="text-[14px] font-semibold text-muted-foreground">#{l.rank}</span>}
                </div>
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500/20 to-emerald-500/15 text-[12px] font-semibold text-teal-700 dark:text-teal-300">
                  {l.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold">{l.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">{l.batch}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className={cn('font-mono text-[17px] font-semibold tabular-nums', l.score >= 90 ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground')}>{l.score}%</div>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                    <Flame className="size-3" />{l.streak}d streak
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeTab === 'engagement' && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <BarChart3 className="size-4 text-teal-600 dark:text-teal-300" />
              Engagement Heatmap
            </div>
            <div className="space-y-3">
              {ENGAGEMENT_HEAT.map((e) => (
                <div key={e.label} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 text-[12px] font-medium text-foreground/80">{e.label}</div>
                  <div className="flex-1 h-6 overflow-hidden rounded-full bg-foreground/5">
                    <div
                      className={cn('h-full rounded-full flex items-center pl-2', e.pct >= 70 ? 'bg-linear-to-r from-teal-500 to-emerald-500' : e.pct >= 50 ? 'bg-linear-to-r from-amber-400 to-amber-500' : 'bg-linear-to-r from-rose-400 to-rose-500')}
                      style={{ width: `${e.pct}%` }}
                    >
                      <span className="text-[10px] font-semibold text-white">{e.pct}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-teal-500/20 bg-linear-to-br from-teal-500/8 via-transparent to-emerald-500/8 p-5">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300" />
              <div>
                <div className="text-[13px] font-semibold">Engagement insight</div>
                <p className="mt-1 text-[12.5px] leading-snug text-foreground/85">
                  87% completed the quiz but only 35% asked a question. Consider a structured Q&amp;A prompt at session start to increase participation.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={finalize}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-700 px-6 text-[14px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]"
        >
          Mark analytics reviewed
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent: boolean }) {
  return (
    <div className={cn('rounded-2xl border p-3.5', accent ? 'border-teal-500/30 bg-teal-500/5' : 'border-border/60 bg-card')}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums">{value}</div>
      <div className="text-[10.5px] text-muted-foreground">{sub}</div>
    </div>
  )
}

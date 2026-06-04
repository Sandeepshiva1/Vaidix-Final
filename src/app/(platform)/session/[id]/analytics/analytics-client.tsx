'use client'

import { useRouter } from 'next/navigation'
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
  TrendingUp,
  Trophy,
  Users2,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SessionHeader } from '@/components/medlearn/session-header'
import type { SessionView } from '@/lib/medlearn/session-view'

// ─── Real data contract (populated server-side; honest-empty pre-session) ──────
export interface AnalyticsData {
  cohortTotal: number
  readiness: {
    ready: number
    atRisk: number
    underprepared: number
    averageScore: number
  }
  prereads: Array<{ file: string; opens: number; total: number; pct: number }>
  leaderboard: Array<{
    userId: string
    name: string
    score: number
    tier: 'READY' | 'AT_RISK' | 'UNDERPREPARED'
    preReadings: { count: number; total: number }
    preVideos: { count: number; total: number }
  }>
  questionThemes: Array<{ label: string; summary: string; questionCount: number }>
  totalQuestions: number
  mcqs: Array<{ id: string; q: string; optionCount: number }>
  engagement: {
    participants: number
    chat: number
    hooks: number
    handRaises: number
    attentionDrops: number
    score: number
  }
}

const TIER_LABEL: Record<AnalyticsData['leaderboard'][number]['tier'], string> = {
  READY: 'Fellowship',
  AT_RISK: 'At Risk',
  UNDERPREPARED: 'Underprepared',
}

const RANK_MEDAL: Record<number, React.ReactNode> = {
  1: <Medal className="size-5 text-amber-400" />,
  2: <Medal className="size-5 text-slate-400" />,
  3: <Medal className="size-5 text-amber-700 dark:text-amber-600" />,
}

// Shared "no data yet" line — pre-session sources are legitimately empty.
const EMPTY_HINT = 'No data yet — appears after the session runs.'

function EmptyNote({ children = EMPTY_HINT }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-background/40 px-4 py-6 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  )
}

export function AnalyticsClient({ session, data }: { session: SessionView; data: AnalyticsData }) {
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<'overview' | 'quiz' | 'leaderboard' | 'engagement'>('overview')

  const finalize = () => {
    router.push(`/session/${session.id}/pre`)
  }

  const cohortTotal = data.cohortTotal
  const { ready, atRisk, underprepared, averageScore } = data.readiness

  // Cohort distribution segments — bound to the readiness tiers.
  const cohortSegments = [
    { label: 'Underprepared', count: underprepared, color: 'bg-rose-500',    text: 'text-rose-700 dark:text-rose-300',     dot: 'bg-rose-500' },
    { label: 'At Risk',       count: atRisk,        color: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-300',   dot: 'bg-amber-500' },
    { label: 'Session Ready', count: ready,         color: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  ]

  // Top stats — real readiness / engagement numbers.
  const totalPrereadOpens = data.prereads.reduce((s, p) => s + p.opens, 0)
  const fullyPrepared = ready

  // Leaderboard from real readiness scores (sorted high→low for the ranking view).
  const leaderboard = [...data.leaderboard]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((l, i) => ({ ...l, rank: i + 1 }))

  // Engagement heatmap from real live-signal counts (capped at 100%).
  const participants = data.engagement.participants
  const ratePct = (n: number) => (participants === 0 ? 0 : Math.min(100, Math.round((n / participants) * 100)))
  const engagementHeat = [
    { label: 'Chat messages', pct: ratePct(data.engagement.chat) },
    { label: 'Hook responses', pct: ratePct(data.engagement.hooks) },
    { label: 'Hand raises', pct: ratePct(data.engagement.handRaises) },
  ]
  const hasEngagement =
    participants > 0 ||
    data.engagement.chat + data.engagement.hooks + data.engagement.handRaises + data.engagement.attentionDrops > 0

  return (
    <div className="mx-auto max-w-6xl">
      <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 4 · Responses & Analytics" />

      {/* Top stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<BookOpen className="size-4" />}  label="Preread opens"      value={String(totalPrereadOpens)} sub={`across ${data.prereads.length} files`} accent={false} />
        <StatCard icon={<HelpCircle className="size-4" />} label="Live participants"  value={String(participants)} sub={cohortTotal > 0 ? `of ${cohortTotal} cohort` : 'in last window'} accent={false} />
        <StatCard icon={<Target className="size-4" />}    label="Avg. readiness"     value={`${averageScore}`} sub="out of 100" accent />
        <StatCard icon={<Users2 className="size-4" />}    label="Fully prepared"     value={String(fullyPrepared)} sub="ready tier" accent={false} />
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
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-rose-700 dark:text-rose-300">{atRisk}</div>
              <div className="text-[10.5px] text-muted-foreground">of {cohortTotal} learners</div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"><Zap className="size-3.5" />Underprepared</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-amber-700 dark:text-amber-300">{underprepared}</div>
              <div className="text-[10.5px] text-muted-foreground">&lt; 40 readiness</div>
            </div>
            <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-teal-700 dark:text-teal-300"><Target className="size-3.5" />Avg Readiness</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-teal-700 dark:text-teal-300">{averageScore}</div>
              <div className="text-[10.5px] text-muted-foreground">out of 100</div>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3.5" />Session-Ready</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{ready}</div>
              <div className="text-[10.5px] text-muted-foreground">of {cohortTotal} learners</div>
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
              {data.prereads.length === 0 ? (
                <EmptyNote>No prereads assigned yet — opens appear once learners view them.</EmptyNote>
              ) : (
                <div className="space-y-3">
                  {data.prereads.map((p) => (
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
              )}
            </section>

            {/* Question themes (real pre-question clustering) */}
            <section className="rounded-3xl border border-border/60 bg-card p-5">
              <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
                <BarChart3 className="size-4 text-teal-600 dark:text-teal-300" />
                Question Themes
              </div>
              {data.questionThemes.length === 0 ? (
                <EmptyNote>No question themes yet — they cluster once learners submit pre-class questions.</EmptyNote>
              ) : (
                <ul className="space-y-1.5">
                  {data.questionThemes.map((t) => (
                    <li key={t.label} className="flex items-center gap-2 rounded-xl bg-teal-50/80 px-3 py-1.5 text-[12px] font-medium text-teal-800 dark:bg-teal-500/10 dark:text-teal-300">
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      <span className="flex-1 min-w-0 truncate">{t.label}</span>
                      <span className="shrink-0 font-mono tabular-nums text-[11px]">{t.questionCount}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Cohort Readiness Distribution */}
          <section className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <Users2 className="size-4 text-teal-600 dark:text-teal-300" />
              Cohort Readiness Distribution
              <span className="ml-auto text-[11.5px] font-normal text-muted-foreground">{cohortTotal} learners total</span>
            </div>
            {cohortTotal === 0 ? (
              <EmptyNote>No learners enrolled yet — distribution appears once the cohort is set.</EmptyNote>
            ) : (
              <>
                <div className="flex h-9 overflow-hidden rounded-xl">
                  {cohortSegments.map((seg) => (
                    <div
                      key={seg.label}
                      className={cn('flex items-center justify-center text-[11px] font-bold text-white transition-all', seg.color)}
                      style={{ width: `${(seg.count / cohortTotal) * 100}%` }}
                    >
                      {seg.count > 0 ? seg.count : ''}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {cohortSegments.map((seg) => (
                    <div key={seg.label} className="flex items-center gap-1.5 text-[11.5px]">
                      <span className={cn('size-2.5 shrink-0 rounded-full', seg.dot)} />
                      <span className={cn('font-semibold', seg.text)}>{seg.count}</span>
                      <span className="text-muted-foreground">{seg.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Live engagement snapshot (real signal counts) */}
          <section className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <BarChart3 className="size-4 text-teal-600 dark:text-teal-300" />
              Live Engagement — Last 5 Minutes
            </div>
            {!hasEngagement ? (
              <EmptyNote>No live activity yet — engagement appears once the session goes live.</EmptyNote>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MiniStat label="Participants" value={participants} />
                <MiniStat label="Chat messages" value={data.engagement.chat} />
                <MiniStat label="Hook responses" value={data.engagement.hooks} />
                <MiniStat label="Hand raises" value={data.engagement.handRaises} />
              </div>
            )}
          </section>

          {/* AI Insights — derived honestly from real numbers */}
          <section className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <Sparkles className="size-4 text-teal-600 dark:text-teal-300" />
              AI Insights
            </div>
            {cohortTotal === 0 ? (
              <EmptyNote>Insights appear once there is cohort readiness data to analyse.</EmptyNote>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="size-4" />
                    <span className="text-rose-800 dark:text-rose-200">{underprepared} learners underprepared</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-foreground/80">
                    {underprepared > 0
                      ? 'These learners score below 40 on readiness. Consider a direct nudge before the session.'
                      : 'No learners are in the underprepared tier — the cohort is tracking well.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
                    <Zap className="size-4" />
                    <span className="text-amber-800 dark:text-amber-200">{atRisk} learners at risk</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-foreground/80">
                    Readiness between 40 and 69. A targeted preread reminder will move them into the ready tier.
                  </p>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <TrendingUp className="size-4" />
                    <span className="text-emerald-800 dark:text-emerald-200">Average readiness {averageScore}/100</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-foreground/80">
                    {ready} of {cohortTotal} learners are session-ready. {totalPrereadOpens} preread opens recorded so far.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'quiz' && (
        <div className="space-y-3">
          <div className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[13.5px] font-semibold">Authored MCQs</div>
              <div className="text-[12px] text-muted-foreground">{data.mcqs.length} questions</div>
            </div>
            {data.mcqs.length === 0 ? (
              <EmptyNote>No MCQs authored yet — add them in the Prepare Learners step. Response rates appear after the session.</EmptyNote>
            ) : (
              <div className="space-y-3">
                {data.mcqs.map((m, i) => (
                  <div key={m.id} className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-teal-500/15 text-[10.5px] font-semibold text-teal-700 dark:text-teal-300">Q{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-medium leading-snug">{m.q}</p>
                        <div className="mt-2 flex items-center gap-3">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/5">
                            <div className="h-full rounded-full bg-foreground/15" style={{ width: '100%' }} />
                          </div>
                          <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{m.optionCount} options</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-teal-500/20 bg-linear-to-br from-teal-500/8 via-transparent to-emerald-500/8 p-5">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300" />
              <div>
                <div className="text-[13px] font-semibold">Vaidix recommendation</div>
                <p className="mt-1 text-[12.5px] leading-snug text-foreground/85">
                  {data.mcqs.length === 0
                    ? 'Author a short preread quiz to capture readiness gaps before the session — per-question accuracy will surface here once learners respond.'
                    : `You have authored ${data.mcqs.length} MCQ${data.mcqs.length === 1 ? '' : 's'}. Per-question accuracy will surface here once learners submit their responses.`}
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
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Ranked by readiness score (prep signals + attendance) · {leaderboard.length} learners</p>
          </div>
          {leaderboard.length === 0 ? (
            <div className="p-5">
              <EmptyNote>No learners enrolled yet — the leaderboard ranks the cohort by readiness once they begin prep.</EmptyNote>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {leaderboard.map((l) => (
                <li key={l.userId} className={cn('flex items-center gap-4 px-5 py-4 transition-colors hover:bg-foreground/3', l.rank <= 3 && 'bg-amber-50/40 dark:bg-amber-500/5')}>
                  <div className="w-7 shrink-0 text-center">
                    {RANK_MEDAL[l.rank] ?? <span className="text-[14px] font-semibold text-muted-foreground">#{l.rank}</span>}
                  </div>
                  <div className="grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500/20 to-emerald-500/15 text-[12px] font-semibold text-teal-700 dark:text-teal-300">
                    {l.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold">{l.name}</div>
                    <div className="text-[11.5px] text-muted-foreground">{TIER_LABEL[l.tier]}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className={cn('font-mono text-[17px] font-semibold tabular-nums', l.score >= 70 ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground')}>{l.score}</div>
                    </div>
                    <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                      <Flame className="size-3" />{l.preReadings.count + l.preVideos.count} prep
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'engagement' && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
              <BarChart3 className="size-4 text-teal-600 dark:text-teal-300" />
              Engagement Heatmap
            </div>
            {!hasEngagement ? (
              <EmptyNote>No live engagement yet — chat, hook, and hand-raise rates appear once the session goes live.</EmptyNote>
            ) : (
              <div className="space-y-3">
                {engagementHeat.map((e) => (
                  <div key={e.label} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 text-[12px] font-medium text-foreground/80">{e.label}</div>
                    <div className="flex-1 h-6 overflow-hidden rounded-full bg-foreground/5">
                      <div
                        className={cn('h-full rounded-full flex items-center pl-2', e.pct >= 70 ? 'bg-linear-to-r from-teal-500 to-emerald-500' : e.pct >= 50 ? 'bg-linear-to-r from-amber-400 to-amber-500' : 'bg-linear-to-r from-rose-400 to-rose-500')}
                        style={{ width: `${Math.max(e.pct, 6)}%` }}
                      >
                        <span className="text-[10px] font-semibold text-white">{e.pct}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-teal-500/20 bg-linear-to-br from-teal-500/8 via-transparent to-emerald-500/8 p-5">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300" />
              <div>
                <div className="text-[13px] font-semibold">Engagement insight</div>
                <p className="mt-1 text-[12.5px] leading-snug text-foreground/85">
                  {!hasEngagement
                    ? 'Once the session is live, interaction rates per participant surface here so you can prompt a quieter cohort in real time.'
                    : `Engagement score ${data.engagement.score}/100 across ${participants} participant${participants === 1 ? '' : 's'} in the last 5 minutes. ${data.engagement.attentionDrops > 0 ? `${data.engagement.attentionDrops} attention-drop signal${data.engagement.attentionDrops === 1 ? '' : 's'} — consider a hook or break.` : 'Attention is holding steady.'}`}
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

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

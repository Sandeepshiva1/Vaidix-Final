'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  FileText,
  Filter,
  HelpCircle,
  Mic,
  ListChecks,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Users2,
  Video,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SessionHeader } from '@/components/medlearn/session-header'
import { markQuestionsReviewedAction } from '@/components/medlearn/actions'
import type { SessionView } from '@/lib/medlearn/session-view'
import type {
  PreQuestionView,
  DashboardResult,
} from '@/server/services/pre-questions/pre-questions-service'

// View model the demo's card markup expects. We derive it from the real
// PreQuestionView so the JSX below is untouched.
interface Question {
  id: string
  text: string
  cluster: string
  urgency: 'low' | 'medium' | 'high'
  votes: number
  students: number
  tags: string[]
  isRepeated?: boolean
}

interface PeerAnswer {
  author: string
  text: string
  upvotes: number
}

// Real PreSessionQuestionUrgency (LOW | NORMAL | HIGH) → demo's 3-tone pill.
function mapUrgency(u: PreQuestionView['urgency']): Question['urgency'] {
  return u === 'HIGH' ? 'high' : u === 'LOW' ? 'low' : 'medium'
}

// Heatmap palette buckets — driven by a theme's share of the question volume
// rather than a hand-tuned mock value. Keeps the exact rose→amber→sky→teal
// ramp the demo used (highest rank = hottest).
function heatColor(rank: number): 'rose' | 'amber' | 'sky' | 'teal' {
  return rank === 0 ? 'rose' : rank <= 2 ? 'amber' : rank <= 4 ? 'sky' : 'teal'
}

type Action = 'answer' | 'poll' | 'live' | 'important' | null

export function QuestionsClient({
  session,
  questions,
  dashboard,
}: {
  session: SessionView
  questions: PreQuestionView[]
  dashboard: DashboardResult
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [filter, setFilter] = useState<string | null>(null)
  const [actions, setActions] = useState<Record<string, Action>>({})
  const [search, setSearch] = useState('')
  const [expandedQ, setExpandedQ] = useState<string | null>(null)
  const [validatedPeers, setValidatedPeers] = useState<Set<string>>(new Set())
  const [removedPeers, setRemovedPeers] = useState<Set<string>>(new Set())
  const [responseMode, setResponseMode] = useState<Record<string, 'doc' | 'voice' | 'video' | null>>({})

  // ── Real data → demo view models ──────────────────────────────────────────
  // Theme label counts so a question repeated across the same theme can carry
  // the demo's "Repeated theme" badge honestly (theme has >1 question).
  const themeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of dashboard.topThemes) m.set(t.id, t.questionCount)
    return m
  }, [dashboard.topThemes])

  const QUESTIONS = useMemo<Question[]>(
    () =>
      questions.map((q) => ({
        id: q.id,
        text: q.content,
        cluster: q.themeLabel ?? 'Unthemed',
        urgency: mapUrgency(q.urgency),
        votes: q.voteCount,
        students: q.voteCount, // distinct upvoters ≈ asking learners for this question
        tags: q.themeLabel ? [q.themeLabel] : [],
        isRepeated: q.themeId ? (themeCounts.get(q.themeId) ?? 0) > 1 : false,
      })),
    [questions, themeCounts]
  )

  // Peer answers = real replies on each question.
  const PEER_ANSWERS = useMemo<Record<string, PeerAnswer[]>>(() => {
    const map: Record<string, PeerAnswer[]> = {}
    for (const q of questions) {
      if (q.replies.length === 0) continue
      map[q.id] = q.replies.map((r) => ({
        author: r.isPresenter ? `${r.authorName} (Presenter)` : r.authorName,
        text: r.content,
        upvotes: 0, // replies aren't voted on in the real model
      }))
    }
    return map
  }, [questions])

  // AI clusters + confusion heatmap, derived from real dashboard themes.
  const CLUSTERS = useMemo(() => {
    const max = dashboard.topThemes.reduce((acc, t) => Math.max(acc, t.questionCount), 0) || 1
    return dashboard.topThemes.map((t) => ({
      name: t.label,
      count: t.questionCount,
      heat: Math.round((t.questionCount / max) * 100),
      color: heatColor(t.rank),
    }))
  }, [dashboard.topThemes])

  const askingLearners = useMemo(
    () => new Set(questions.map((q) => q.userId)).size,
    [questions]
  )

  const hasQuestions = questions.length > 0
  const hasThemes = CLUSTERS.length > 0
  const topTheme = dashboard.topThemes[0] ?? null

  const filtered = useMemo(() => {
    return QUESTIONS.filter((q) => {
      if (filter && q.cluster !== filter) return false
      if (search && !q.text.toLowerCase().includes(search.toLowerCase()) && !q.tags.join(' ').toLowerCase().includes(search.toLowerCase())) return false
      return true
    }).sort((a, b) => b.votes - a.votes)
  }, [QUESTIONS, filter, search])

  const setAction = (qid: string, action: Action) =>
    setActions((m) => ({ ...m, [qid]: m[qid] === action ? null : action }))

  // Persist the "reviewed" acknowledgement before returning to the pre-conference
  // overview — this is what lights up the "Incoming Questions" step. Without the
  // server action the step would never complete (it no longer derives from the
  // raw question count). Mirrors analytics-client's finalize.
  const finalize = () => {
    startTransition(async () => {
      const res = await markQuestionsReviewedAction(session.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.push(`/session/${session.id}/pre`)
      router.refresh()
    })
  }

  return (
    <div className="mx-auto max-w-7xl">
      <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 5 · Incoming Questions" />

      {/* Top stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={<HelpCircle className="size-4" />} label="Questions" value={QUESTIONS.length.toString()} />
        <Stat icon={<Users2 className="size-4" />} label="Asking learners" value={askingLearners.toString()} />
        <Stat icon={<Sparkles className="size-4" />} label="AI clusters" value={CLUSTERS.length.toString()} accent />
        <Stat icon={<AlertTriangle className="size-4" />} label="High urgency" value={QUESTIONS.filter((q) => q.urgency === 'high').length.toString()} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* Left column: questions */}
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card p-2">
            <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-background/60 px-2.5">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search questions or tags…"
                className="h-full flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setFilter(null)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors',
                  filter === null ? 'border-teal-500/50 bg-teal-500/10 text-teal-700 dark:text-teal-300' : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground'
                )}
              >
                <Filter className="size-3.5" />
                All clusters
              </button>
            </div>
          </div>

          {/* Question cards */}
          <ul className="space-y-2.5">
            {filtered.map((q) => (
              <li
                key={q.id}
                className={cn(
                  'group rounded-2xl border bg-card p-4 transition-all',
                  actions[q.id] ? 'border-teal-500/50 ring-1 ring-teal-500/15' : 'border-border/60 hover:border-foreground/15'
                )}
              >
                <div className="flex items-start gap-3">
                  {/* vote pill */}
                  <div className="flex shrink-0 flex-col items-center gap-0.5 rounded-xl bg-foreground/[0.03] px-2 py-1.5">
                    <ArrowUp className="size-3.5 text-teal-600 dark:text-teal-300" />
                    <span className="font-mono text-[13px] font-semibold tabular-nums">{q.votes}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <UrgencyPill urgency={q.urgency} />
                      <span className="rounded-md bg-teal-500/8 px-1.5 py-0.5 font-medium text-teal-700 dark:text-teal-300">{q.cluster}</span>
                      {q.isRepeated && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/8 px-1.5 py-0.5 font-medium text-indigo-700 dark:text-indigo-300">
                          <Zap className="size-2.5" /> Repeated theme
                        </span>
                      )}
                      <span className="ml-auto inline-flex items-center gap-1 text-[10.5px]">
                        <Users2 className="size-3" />
                        {q.students} learners
                      </span>
                    </div>
                    <p className="mt-1.5 text-[14px] font-medium leading-snug">{q.text}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {q.tags.map((t) => (
                        <span key={t} className="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">#{t}</span>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <ActionBtn on={actions[q.id] === 'answer'} onClick={() => setAction(q.id, 'answer')} icon={<CheckCircle2 className="size-3.5" />} label="Answer now" />
                      <ActionBtn on={actions[q.id] === 'poll'} onClick={() => setAction(q.id, 'poll')} icon={<ListChecks className="size-3.5" />} label="Convert to poll" />
                      <ActionBtn on={actions[q.id] === 'live'} onClick={() => setAction(q.id, 'live')} icon={<BookmarkPlus className="size-3.5" />} label="Save for live" />
                      <ActionBtn on={actions[q.id] === 'important'} onClick={() => setAction(q.id, 'important')} icon={actions[q.id] === 'important' ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />} label="Mark important" />
                      {PEER_ANSWERS[q.id] && (
                        <ActionBtn on={expandedQ === q.id} onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)} icon={<MessageSquare className="size-3.5" />} label={`${PEER_ANSWERS[q.id].length} peer answer${PEER_ANSWERS[q.id].length > 1 ? 's' : ''}`} />
                      )}
                    </div>

                    {/* Peer answers */}
                    {PEER_ANSWERS[q.id] && expandedQ === q.id && (
                      <div className="mt-3 space-y-2 rounded-2xl border border-indigo-500/20 bg-indigo-50/60 p-3 dark:bg-indigo-500/8">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                          <Users2 className="size-3.5" />
                          Peer answers — review before session
                        </div>
                        {PEER_ANSWERS[q.id]
                          .filter((_, pi) => !removedPeers.has(`${q.id}-${pi}`))
                          .map((pa, pi) => (
                          <div key={pi} className={cn('rounded-xl border bg-white/80 p-2.5 dark:bg-background/60', validatedPeers.has(`${q.id}-${pi}`) ? 'border-emerald-500/40' : 'border-border/60')}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-[10.5px] font-semibold text-muted-foreground">{pa.author}</div>
                                <p className="mt-0.5 text-[12px] leading-snug">{pa.text}</p>
                                {pa.upvotes > 0 && (
                                  <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                                    <ThumbsUp className="size-3" />{pa.upvotes} learners found this helpful
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-col gap-1">
                                {!validatedPeers.has(`${q.id}-${pi}`) ? (
                                  <button type="button" onClick={() => setValidatedPeers((s) => new Set(s).add(`${q.id}-${pi}`))} className="inline-flex h-6 items-center gap-1 rounded-lg bg-emerald-500 px-2 text-[10px] font-medium text-white">
                                    <ThumbsUp className="size-2.5" /> Validate
                                  </button>
                                ) : (
                                  <span className="inline-flex h-6 items-center gap-1 rounded-lg bg-emerald-500/15 px-2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                    <CheckCircle2 className="size-2.5" /> Validated
                                  </span>
                                )}
                                <button type="button" onClick={() => setRemovedPeers((s) => new Set(s).add(`${q.id}-${pi}`))} className="inline-flex h-6 items-center gap-1 rounded-lg border border-border/60 px-2 text-[10px] font-medium text-muted-foreground hover:border-rose-400/50 hover:text-rose-600">
                                  <ThumbsDown className="size-2.5" /> Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Faculty response upload */}
                    {actions[q.id] === 'answer' && (
                      <div className="mt-3 rounded-2xl border border-teal-500/20 bg-teal-50/60 p-3 dark:bg-teal-500/8">
                        <div className="mb-2 text-[11px] font-semibold text-teal-700 dark:text-teal-300">Upload your response</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(['doc', 'voice', 'video'] as const).map((m) => {
                            const icons = { doc: <FileText className="size-3.5" />, voice: <Mic className="size-3.5" />, video: <Video className="size-3.5" /> }
                            const labels = { doc: 'Document', voice: 'Voice note', video: 'Video link' }
                            const active = responseMode[q.id] === m
                            return (
                              <button key={m} type="button" onClick={() => setResponseMode((r) => ({ ...r, [q.id]: active ? null : m }))} className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors', active ? 'border-teal-500/50 bg-teal-500/12 text-teal-700 dark:text-teal-300' : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-foreground/5')}>
                                {icons[m]}{labels[m]}
                              </button>
                            )
                          })}
                        </div>
                        {responseMode[q.id] && (
                          <div className="mt-2">
                            {responseMode[q.id] === 'doc' && <div className="flex items-center gap-2 rounded-xl border border-dashed border-teal-500/40 bg-white/60 px-3 py-2 text-[11.5px] text-teal-700 dark:bg-teal-500/5 dark:text-teal-300"><FileText className="size-3.5" /> Click to attach PDF or Word document</div>}
                            {responseMode[q.id] === 'voice' && <div className="flex items-center gap-2 rounded-xl border border-dashed border-teal-500/40 bg-white/60 px-3 py-2 text-[11.5px] text-teal-700 dark:bg-teal-500/5 dark:text-teal-300"><Mic className="size-3.5" /> Hold to record a voice note (up to 2 min)</div>}
                            {responseMode[q.id] === 'video' && <input placeholder="Paste a video link (YouTube, Vimeo, Loom…)" className="w-full rounded-xl border border-teal-500/30 bg-white/60 px-3 py-2 text-[11.5px] outline-none dark:bg-teal-500/5" />}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Expand toggle */}
                    <button type="button" onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)} className="mt-2 flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground">
                      <ChevronDown className={cn('size-3 transition-transform', expandedQ === q.id && 'rotate-180')} />
                      {expandedQ === q.id ? 'Collapse' : 'Expand details'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/40 py-8 text-center text-[13px] text-muted-foreground">
                {hasQuestions
                  ? 'No questions match that filter.'
                  : 'No incoming questions yet — they appear as learners submit them.'}
              </div>
            )}
          </ul>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={finalize}
              disabled={isPending}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100"
            >
              {isPending ? 'Saving…' : 'Mark questions reviewed'}
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>

        {/* Right column: AI clusters + heatmap */}
        <aside className="space-y-4">
          {/* AI clusters */}
          <section className="rounded-3xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
              <Sparkles className="size-4 text-teal-600 dark:text-teal-300" />
              AI-clustered topics
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Recurring themes Vaidix found across your learners.</p>
            {!hasThemes && (
              <p className="mt-3 rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-3 text-[11.5px] text-muted-foreground">
                {hasQuestions
                  ? 'Themes are generating — Vaidix clusters questions shortly after learners submit them.'
                  : 'Themes appear here once learners start asking questions.'}
              </p>
            )}
            <ul className="mt-3 space-y-1.5">
              {CLUSTERS.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => setFilter(filter === c.name ? null : c.name)}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-xl border bg-background/60 px-2.5 py-1.5 text-left transition-colors',
                      filter === c.name ? 'border-teal-500/50 ring-1 ring-teal-500/20' : 'border-border/60 hover:border-foreground/15'
                    )}
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', dotColor(c.color))} />
                    <span className="flex-1 truncate text-[12px] font-medium">{c.name}</span>
                    <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Confusion heatmap */}
          <section className="rounded-3xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
              <Star className="size-4 text-amber-500" />
              Confusion heatmap
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Where learners are stuck. Larger = more questions, brighter = higher urgency.
            </p>

            {!hasThemes && (
              <p className="mt-3 rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-3 text-[11.5px] text-muted-foreground">
                {hasQuestions ? 'The heatmap lights up once themes are generated.' : 'Nothing to map yet.'}
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {CLUSTERS.map((c) => {
                const size = 30 + c.heat * 0.7
                return (
                  <div
                    key={c.name}
                    className={cn(
                      'flex items-center justify-center rounded-xl text-center',
                      heatBg(c.color, c.heat)
                    )}
                    style={{ height: `${size}px` }}
                    title={`${c.name} · heat ${c.heat}`}
                  >
                    <span className="px-1 text-[9.5px] font-semibold leading-tight">{c.name.split(' ')[0]}</span>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Low concern</span>
              <div className="h-1.5 flex-1 mx-2 rounded-full bg-linear-to-r from-teal-200 via-amber-300 to-rose-400" />
              <span>High</span>
            </div>
          </section>

          {topTheme && (
          <section className="rounded-3xl border border-teal-500/20 bg-linear-to-br from-teal-500/8 via-transparent to-emerald-500/8 p-4">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-600 dark:text-teal-300" />
              <div>
                <div className="text-[12.5px] font-semibold">Suggested live opener</div>
                <p className="mt-1 text-[12px] leading-snug text-foreground/85">
                  &ldquo;Before we begin: most of you asked about {topTheme.label}. Let&apos;s anchor on that today.&rdquo;
                </p>
              </div>
            </div>
          </section>
          )}
        </aside>
      </div>
    </div>
  )
}

// ─── helpers ───────────────────────────────────────────────────────────────
function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3.5',
        accent ? 'border-teal-500/30 bg-teal-500/5' : 'border-border/60 bg-card'
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-[24px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function UrgencyPill({ urgency }: { urgency: Question['urgency'] }) {
  const map = {
    high: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    low: 'bg-foreground/5 text-muted-foreground',
  } as const
  return <span className={cn('rounded-md px-1.5 py-0.5 font-semibold capitalize', map[urgency])}>{urgency}</span>
}

function ActionBtn({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors',
        on
          ? 'border-teal-500/40 bg-teal-500/12 text-teal-700 dark:text-teal-300'
          : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function dotColor(color: string): string {
  return color === 'rose' ? 'bg-rose-500' : color === 'amber' ? 'bg-amber-500' : color === 'sky' ? 'bg-sky-500' : 'bg-teal-500'
}

// Static class map — Tailwind v4 scans source for full class strings, so we
// can't build these by template literal.
const HEAT_BG: Record<string, Record<string, string>> = {
  rose:  { '500': 'bg-rose-500 text-white',  '400': 'bg-rose-400 text-white',  '300': 'bg-rose-300 text-foreground/80', '200': 'bg-rose-200 text-foreground/80' },
  amber: { '500': 'bg-amber-500 text-white', '400': 'bg-amber-400 text-white', '300': 'bg-amber-300 text-foreground/80', '200': 'bg-amber-200 text-foreground/80' },
  sky:   { '500': 'bg-sky-500 text-white',   '400': 'bg-sky-400 text-white',   '300': 'bg-sky-300 text-foreground/80', '200': 'bg-sky-200 text-foreground/80' },
  teal:  { '500': 'bg-teal-500 text-white',  '400': 'bg-teal-400 text-white',  '300': 'bg-teal-300 text-foreground/80', '200': 'bg-teal-200 text-foreground/80' },
}

function heatBg(color: string, heat: number): string {
  const intensity = heat >= 80 ? '500' : heat >= 50 ? '400' : heat >= 30 ? '300' : '200'
  return HEAT_BG[color]?.[intensity] ?? 'bg-foreground/5 text-foreground/80'
}

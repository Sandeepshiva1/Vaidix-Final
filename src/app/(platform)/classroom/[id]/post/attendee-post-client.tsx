'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronUp,
  FileText, MessageCircle, Play, Sparkles, Trophy, X, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Pearl { id: string; title: string; body: string }

interface MyDoubt {
  id: string
  text: string
  answer: string | null
  answeredByName: string | null
  endorsed: number
  time: string
}

interface Material {
  linkId: string
  title: string
  kind: string
  isPresentation: boolean
  url: string | null
}

interface McqQuestion {
  id: string
  q: string
  options: string[]
  correct: number
}

interface OeQuestion {
  id: string
  q: string
}

interface QuizResponseMap {
  [qId: string]: { answer: number; answerText?: string | null; isCorrect?: boolean | null }
}

interface Props {
  sessionId: string
  sessionTitle: string
  presenterName: string
  sessionDate: string
  hasRecording: boolean
  pearls: Pearl[]
  myDoubts: MyDoubt[]
  materials: Material[]
  myReadinessScore: number | null
  mcqs: McqQuestion[]
  openEnded: OeQuestion[]
  responseMap: QuizResponseMap
}

type Tab = 'summary' | 'pearls' | 'doubts' | 'materials' | 'performance'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'summary',     label: 'Summary',     icon: <Sparkles className="size-3.5" /> },
  { key: 'pearls',      label: 'Key Learnings', icon: <Zap className="size-3.5" /> },
  { key: 'doubts',      label: 'My Questions', icon: <MessageCircle className="size-3.5" /> },
  { key: 'materials',   label: 'Materials',   icon: <FileText className="size-3.5" /> },
  { key: 'performance', label: 'My Performance', icon: <BarChart3 className="size-3.5" /> },
]

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AttendeePostClient({
  sessionId, sessionTitle, presenterName, sessionDate, hasRecording,
  pearls, myDoubts, materials, myReadinessScore, mcqs, openEnded, responseMap,
}: Props) {
  const [tab, setTab] = useState<Tab>('summary')
  const [expandedPearl, setExpandedPearl] = useState<string | null>(pearls[0]?.id ?? null)

  const totalQuestions = mcqs.length + openEnded.length
  const answeredCount = Object.values(responseMap).length
  const correctCount = Object.values(responseMap).filter((r) => r.isCorrect === true).length
  const quizScore = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : null

  const readinessColor =
    (myReadinessScore ?? 0) >= 80 ? 'text-emerald-600'
    : (myReadinessScore ?? 0) >= 50 ? 'text-amber-600'
    : 'text-rose-600'

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Post-Conference</div>
        <h1 className="text-[26px] font-bold tracking-tight leading-tight">{sessionTitle}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {formatDate(sessionDate)} · Presented by <span className="font-medium text-foreground">{presenterName}</span>
        </p>
      </div>

      {/* Recording CTA */}
      {hasRecording && (
        <Link
          href={`/classroom/${sessionId}/recording`}
          className="mb-6 flex items-center gap-4 rounded-3xl border border-teal-500/30 bg-teal-500/5 p-5 transition hover:bg-teal-500/10"
        >
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-teal-500/15 text-teal-700 dark:text-teal-300">
            <Play className="size-6" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-widest text-teal-600">Watch Recording</div>
            <div className="mt-0.5 text-[15px] font-semibold">Replay the session</div>
            <div className="text-[12px] text-muted-foreground">With AI-powered transcript, Q&amp;A and pearls</div>
          </div>
          <Play className="size-5 text-teal-600" />
        </Link>
      )}

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-0.5 overflow-x-auto rounded-2xl border border-border/60 bg-card p-1">
        {TABS.filter((t) => {
          if (t.key === 'doubts' && myDoubts.length === 0) return false
          if (t.key === 'performance' && myReadinessScore === null && totalQuestions === 0) return false
          return true
        }).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-medium transition-all',
              tab === t.key
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── SUMMARY ────────────────────────────────────────────────────────── */}
      {tab === 'summary' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              icon={<Zap className="size-5 text-amber-600" />}
              label="Key Learnings"
              value={pearls.length.toString()}
              color="amber"
            />
            <KpiCard
              icon={<MessageCircle className="size-5 text-violet-600" />}
              label="My Questions"
              value={myDoubts.length.toString()}
              color="violet"
            />
            {myReadinessScore !== null && (
              <KpiCard
                icon={<Trophy className="size-5 text-teal-600" />}
                label="Readiness Score"
                value={`${myReadinessScore}%`}
                color="teal"
              />
            )}
            {quizScore !== null && (
              <KpiCard
                icon={<BarChart3 className="size-5 text-blue-600" />}
                label="Quiz Score"
                value={`${quizScore}%`}
                color="blue"
              />
            )}
          </div>

          {/* Quick links */}
          <div className="space-y-2.5">
            {pearls.length > 0 && (
              <QuickLink icon={<Zap className="size-4" />} label={`${pearls.length} key learning${pearls.length !== 1 ? 's' : ''} extracted`} onClick={() => setTab('pearls')} />
            )}
            {materials.length > 0 && (
              <QuickLink icon={<BookOpen className="size-4" />} label={`${materials.length} session material${materials.length !== 1 ? 's' : ''} available`} onClick={() => setTab('materials')} />
            )}
            {myDoubts.some((d) => d.answer) && (
              <QuickLink icon={<MessageCircle className="size-4" />} label={`${myDoubts.filter((d) => d.answer).length} of your questions got answered`} onClick={() => setTab('doubts')} />
            )}
          </div>
        </div>
      )}

      {/* ── PEARLS ─────────────────────────────────────────────────────────── */}
      {tab === 'pearls' && (
        <div className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold">Key Learnings</h2>
            <p className="text-[12.5px] text-muted-foreground">AI-extracted insights from this session.</p>
          </div>
          {pearls.length === 0 && (
            <div className="rounded-3xl border border-dashed border-border/60 p-10 text-center text-[13px] text-muted-foreground">
              Key learnings are being generated — check back shortly after the session.
            </div>
          )}
          {pearls.map((p) => {
            const open = expandedPearl === p.id
            return (
              <div key={p.id} className="rounded-3xl border border-border/60 bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedPearl(open ? null : p.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left"
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600">
                    <Zap className="size-4" />
                  </div>
                  <p className="flex-1 text-[14px] font-semibold leading-snug">{p.title}</p>
                  {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                </button>
                {open && (
                  <div className="border-t border-border/60 px-5 py-4 pl-16 text-[13.5px] text-muted-foreground leading-relaxed">
                    {p.body}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── MY QUESTIONS ───────────────────────────────────────────────────── */}
      {tab === 'doubts' && (
        <div className="space-y-4">
          <h2 className="text-[17px] font-semibold">My Questions</h2>
          {myDoubts.map((d) => (
            <div key={d.id} className="rounded-3xl border border-border/60 bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600">
                  <MessageCircle className="size-4" />
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-medium leading-snug">{d.text}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <span>{relativeTime(d.time)}</span>
                    {d.endorsed > 0 && <span>· {d.endorsed} upvote{d.endorsed !== 1 ? 's' : ''}</span>}
                    {d.answer && <span className="text-emerald-600 font-medium">· Answered</span>}
                  </div>
                </div>
              </div>
              {d.answer && (
                <div className="mt-3 ml-11 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-600 mb-1">
                    {d.answeredByName ?? 'Presenter'}&apos;s answer
                  </div>
                  <p className="text-[13px] text-foreground leading-relaxed">{d.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── MATERIALS ──────────────────────────────────────────────────────── */}
      {tab === 'materials' && (
        <div className="space-y-4">
          <h2 className="text-[17px] font-semibold">Session Materials</h2>
          {materials.length === 0 && (
            <div className="rounded-3xl border border-dashed border-border/60 p-10 text-center text-[13px] text-muted-foreground">
              No materials were linked to this session.
            </div>
          )}
          {materials.map((m) => (
            <div key={m.linkId} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3.5">
              {m.isPresentation
                ? <FileText className="size-4 text-teal-600" />
                : <BookOpen className="size-4 text-blue-500" />}
              <div className="flex-1 min-w-0">
                <div className="truncate text-[13.5px] font-medium">{m.title}</div>
                <div className="text-[11.5px] text-muted-foreground">{m.isPresentation ? 'Presentation' : m.kind}</div>
              </div>
              {m.url && (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full border border-border/60 bg-background px-3 py-1 text-[12px] font-medium text-foreground hover:bg-foreground/5 transition">
                  Open
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── MY PERFORMANCE ─────────────────────────────────────────────────── */}
      {tab === 'performance' && (
        <div className="space-y-5">
          <h2 className="text-[17px] font-semibold">My Performance</h2>

          {myReadinessScore !== null && (
            <div className="rounded-3xl border border-border/60 bg-card p-6">
              <div className="flex items-center gap-4">
                <div className="grid size-16 place-items-center rounded-2xl bg-teal-500/10 text-teal-700 dark:text-teal-300">
                  <Trophy className="size-8" />
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">Pre-conference Readiness</div>
                  <div className={cn('text-[36px] font-bold tabular-nums', readinessColor)}>{myReadinessScore}%</div>
                  <div className="text-[12px] text-muted-foreground">
                    {myReadinessScore >= 80 ? 'Excellent — you were very well prepared!' : myReadinessScore >= 50 ? 'Good effort. Study materials earlier next time.' : 'Consider completing all pre-reads before the session.'}
                  </div>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/5">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-700', myReadinessScore >= 80 ? 'bg-emerald-500' : myReadinessScore >= 50 ? 'bg-amber-500' : 'bg-rose-500')}
                  style={{ width: `${myReadinessScore}%` }}
                />
              </div>
            </div>
          )}

          {totalQuestions > 0 && (
            <div className="rounded-3xl border border-border/60 bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[14px] font-semibold">Pre-Quiz Review</h3>
                {quizScore !== null && (
                  <span className="font-mono text-[22px] font-bold text-blue-600">{quizScore}%</span>
                )}
              </div>
              <div className="space-y-4">
                {mcqs.map((q, i) => {
                  const resp = responseMap[q.id]
                  const answered = resp !== undefined
                  return (
                    <div key={q.id} className="space-y-2">
                      <p className="text-[13.5px] font-medium">{i + 1}. {q.q}</p>
                      <div className="space-y-1.5 pl-4">
                        {q.options.map((opt, oi) => {
                          const isCorrect = oi === q.correct
                          const myAnswer = answered && resp.answer === oi
                          return (
                            <div key={oi} className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px]',
                              isCorrect ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium' :
                              myAnswer && !isCorrect ? 'bg-rose-500/10 text-rose-600' :
                              'bg-foreground/5 text-muted-foreground')}>
                              <span className={cn('grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                                isCorrect ? 'bg-emerald-500 text-white' :
                                myAnswer ? 'bg-rose-500 text-white' : 'bg-foreground/10')}>
                                {String.fromCharCode(65 + oi)}
                              </span>
                              {opt}
                              {isCorrect && <CheckCircle2 className="ml-auto size-3.5 text-emerald-500" />}
                              {myAnswer && !isCorrect && <X className="ml-auto size-3.5 text-rose-500" />}
                            </div>
                          )
                        })}
                      </div>
                      {!answered && (
                        <p className="pl-4 text-[12px] text-muted-foreground">You didn&apos;t answer this question.</p>
                      )}
                    </div>
                  )
                })}

                {openEnded.map((q, i) => {
                  const resp = responseMap[q.id]
                  return (
                    <div key={q.id} className="space-y-2">
                      <p className="text-[13.5px] font-medium">{mcqs.length + i + 1}. {q.q}</p>
                      <div className="pl-4">
                        {resp?.answerText ? (
                          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[13px] text-foreground">
                            {resp.answerText}
                          </div>
                        ) : (
                          <p className="text-[12px] text-muted-foreground italic">You didn&apos;t answer this question.</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const bg: Record<string, string> = {
    amber: 'bg-amber-500/8',
    violet: 'bg-violet-500/8',
    teal: 'bg-teal-500/8',
    blue: 'bg-blue-500/8',
  }
  return (
    <div className={cn('rounded-2xl border border-border/60 p-4', bg[color] ?? 'bg-foreground/5')}>
      <div className="mb-2">{icon}</div>
      <div className="text-[22px] font-bold tabular-nums">{value}</div>
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
    </div>
  )
}

function QuickLink({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 text-left text-[13.5px] font-medium text-foreground transition hover:bg-foreground/5"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  )
}

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, notFound } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Eye,
  Gamepad2,
  HelpCircle,
  Lightbulb,
  Sparkles,
  Star,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TOPIC_BY_ID } from '@/lib/constants'
import { getLearnSubTopic, type LearnSubTopic, type LearnGame, type LearnQuizQuestion } from '@/lib/learn-content'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'
import { cn } from '@/lib/utils'
import casesData from '@/mock-data/cases.json'
import pearlsData from '@/mock-data/pearls.json'
import type { ClinicalCase, Pearl } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Sections list — acts as in-page navigation and progress tracker
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'read',  label: 'Read',  icon: BookOpen },
  { id: 'play',  label: 'Play',  icon: Gamepad2 },
  { id: 'quiz',  label: 'Quiz',  icon: HelpCircle },
  { id: 'pearls', label: 'Pearls', icon: Sparkles },
  { id: 'cases', label: 'Cases', icon: Eye },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function LearnSubTopicPage() {
  const params = useParams<{ topicId: string; subTopicId: string }>()
  const { topicId, subTopicId } = params
  const topic = TOPIC_BY_ID[topicId]
  const st = getLearnSubTopic(topicId, subTopicId)

  if (!topic || !st) {
    notFound()
  }

  const [activeSection, setActiveSection] = useState<SectionId>('read')
  const [completedSections, setCompletedSections] = useState<Set<SectionId>>(new Set())

  const markDone = (id: SectionId) => {
    setCompletedSections((prev) => new Set([...prev, id]))
    // Auto-advance to next section
    const idx = SECTIONS.findIndex((s) => s.id === id)
    if (idx < SECTIONS.length - 1) {
      setActiveSection(SECTIONS[idx + 1].id)
    }
  }

  // Filtered pearls and cases
  const topicPearls = useMemo(
    () =>
      (pearlsData as unknown as Pearl[]).filter(
        (p) => p.topic === topicId && st.pearlConditions.some((c: string) => p.condition?.toLowerCase().includes(c.toLowerCase()))
      ),
    [topicId, st.pearlConditions]
  )

  const topicCases = useMemo(
    () =>
      (casesData as unknown as ClinicalCase[]).filter(
        (c) => c.topic === topicId && st.caseTitleMatches.some((m: string) => c.title.toLowerCase().includes(m.toLowerCase()))
      ),
    [topicId, st.caseTitleMatches]
  )

  return (
    <PageTransition className="space-y-6">
      {/* Back link */}
      <StaggerItem>
        <Link
          href={`/topics/${topicId}/learn`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All {topic.shortLabel} sub-topics
        </Link>
      </StaggerItem>

      {/* Hero */}
      <StaggerItem>
        <div className={cn('relative overflow-hidden rounded-2xl border-2 p-6', topic.border)}>
          <div className={cn('pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-20 blur-3xl', topic.bg)} />
          <div className="relative">
            <Badge variant="secondary" className="mb-3 text-xs">Learn · {topic.shortLabel}</Badge>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{st.label}</h1>
            <p className="mt-2 text-base text-muted-foreground">{st.description}</p>
          </div>
        </div>
      </StaggerItem>

      {/* Section nav — horizontal pill tabs */}
      <StaggerItem>
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-muted/30 p-1.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const done = completedSections.has(s.id)
            const active = activeSection === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all',
                  active
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-teal-500/40'
                    : 'text-muted-foreground hover:text-foreground',
                  done && !active && 'text-emerald-600 dark:text-emerald-300'
                )}
              >
                {done ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Icon className="size-3.5" />}
                {s.label}
              </button>
            )
          })}
        </div>
      </StaggerItem>

      {/* Section content */}
      {activeSection === 'read' && (
        <ReadSection st={st} topic={topic} onDone={() => markDone('read')} />
      )}
      {activeSection === 'play' && (
        <PlaySection game={st.game} topic={topic} onDone={() => markDone('play')} />
      )}
      {activeSection === 'quiz' && (
        <QuizSection questions={st.quiz} topic={topic} onDone={() => markDone('quiz')} />
      )}
      {activeSection === 'pearls' && (
        <PearlsSection pearls={topicPearls} topic={topic} onDone={() => markDone('pearls')} />
      )}
      {activeSection === 'cases' && (
        <CasesSection cases={topicCases} topicId={topicId} topic={topic} />
      )}
    </PageTransition>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────────

function ReadSection({
  st,
  onDone,
}: {
  st: LearnSubTopic
  topic: typeof TOPIC_BY_ID[string]
  onDone: () => void
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {st.read.map((section, i) => (
        <motion.div
          key={section.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.45 }}
        >
          <Card>
            <CardContent className="space-y-5 px-6 py-6">
              {/* Section heading */}
              <h2 className="text-xl font-bold leading-snug text-foreground">{section.heading}</h2>

              {/* Body paragraphs */}
              <div className="space-y-4">
                {section.body.map((para, pi) => (
                  <p key={pi} className="text-base leading-8 text-foreground/85">{para}</p>
                ))}
              </div>

              {/* ELI5 callout */}
              <div className="rounded-xl border border-teal-500/30 bg-teal-500/6 p-5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                  <Lightbulb className="size-4" />
                  In plain English
                </div>
                <p className="mt-3 text-base leading-8 italic text-foreground/90">{section.plainEnglish}</p>
              </div>

              {/* Citation */}
              <p className="text-xs text-muted-foreground border-t border-border/40 pt-3">
                <span className="font-semibold">Source:</span> {section.citation.authors} ({section.citation.year}). <span className="italic">{section.citation.source}</span>
                {section.citation.ref && <span> — {section.citation.ref}</span>}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ))}

      <div className="flex justify-end pb-4">
        <Button onClick={onDone} size="lg" className="gap-2 px-6">
          Done reading — play the game
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAY — Sort-into-buckets game
// UX: tap a chip to SELECT it (glowing ring) → tap a bucket to PLACE it.
// Chips inside buckets can be tapped to UNASSIGN (returns to the tray).
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_STYLES: Record<string, { idle: string; glow: string; chipBg: string }> = {
  teal:  { idle: 'border-teal-500/40 bg-teal-500/5',  glow: 'ring-2 ring-teal-500/60 shadow-lg shadow-teal-500/20', chipBg: 'bg-teal-500/10 border-teal-500/30 text-teal-800 dark:text-teal-200' },
  rose:  { idle: 'border-rose-500/40 bg-rose-500/5',   glow: 'ring-2 ring-rose-500/60 shadow-lg shadow-rose-500/20', chipBg: 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200' },
  amber: { idle: 'border-amber-500/40 bg-amber-500/5', glow: 'ring-2 ring-amber-500/60 shadow-lg shadow-amber-500/20', chipBg: 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200' },
  blue:  { idle: 'border-blue-500/40 bg-blue-500/5',   glow: 'ring-2 ring-blue-500/60 shadow-lg shadow-blue-500/20', chipBg: 'bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-200' },
}

function PlaySection({
  game,
  onDone,
}: {
  game: LearnGame
  topic: typeof TOPIC_BY_ID[string]
  onDone: () => void
}) {
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [selectedChip, setSelectedChip] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const allAssigned = game.chips.every((c) => assignments[c.id])
  const unassigned = game.chips.filter((c) => !assignments[c.id])

  // Tap an unassigned chip → select it
  const handleSelectChip = (chipId: string) => {
    if (submitted) return
    setSelectedChip(selectedChip === chipId ? null : chipId)
  }

  // Tap a bucket while a chip is selected → place it there
  const handleTapBucket = (bucketId: string) => {
    if (submitted || !selectedChip) return
    setAssignments((prev) => ({ ...prev, [selectedChip]: bucketId }))
    setSelectedChip(null)
  }

  // Tap a placed chip → unassign it (return to tray)
  const handleUnassign = (chipId: string) => {
    if (submitted) return
    setAssignments((prev) => {
      const next = { ...prev }
      delete next[chipId]
      return next
    })
  }

  const score = submitted
    ? game.chips.filter((c) => assignments[c.id] === c.correctBucket).length
    : 0

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gamepad2 className="size-4 text-teal-600 dark:text-teal-300" />
            {game.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{game.instruction}</p>

          {/* Chip tray — unassigned findings */}
          {!submitted && unassigned.length > 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {selectedChip ? '↓ Now tap a bucket below to place it' : 'Tap a finding to pick it up'}
              </p>
              <div className="flex flex-wrap gap-2">
                {unassigned.map((c) => {
                  const selected = selectedChip === c.id
                  return (
                    <motion.button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectChip(c.id)}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className={cn(
                        'rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-all',
                        selected
                          ? 'border-teal-500 bg-teal-500/15 text-teal-800 shadow-lg shadow-teal-500/25 ring-2 ring-teal-400/40 dark:text-teal-100'
                          : 'border-border bg-card text-foreground shadow-sm hover:border-teal-500/40 hover:shadow-md'
                      )}
                    >
                      {c.label}
                    </motion.button>
                  )
                })}
              </div>
            </div>
          )}

          {!submitted && allAssigned && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-center text-sm font-semibold text-emerald-700 dark:text-emerald-300"
            >
              All sorted! Hit submit to check your answers.
            </motion.div>
          )}

          {/* Buckets — tap to place the selected chip */}
          <div className={cn('grid grid-cols-1 gap-4', game.buckets.length <= 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')}>
            {game.buckets.map((bucket) => {
              const style = BUCKET_STYLES[bucket.color] ?? BUCKET_STYLES.teal
              const isTarget = !!selectedChip && !submitted
              const placed = game.chips.filter((c) => assignments[c.id] === bucket.id)

              return (
                <motion.button
                  key={bucket.id}
                  type="button"
                  disabled={!isTarget}
                  onClick={() => handleTapBucket(bucket.id)}
                  whileHover={isTarget ? { scale: 1.02 } : undefined}
                  whileTap={isTarget ? { scale: 0.98 } : undefined}
                  className={cn(
                    'rounded-2xl border-2 p-4 text-left transition-all',
                    style.idle,
                    isTarget && 'cursor-pointer animate-pulse',
                    isTarget && style.glow,
                    !isTarget && !submitted && 'cursor-default'
                  )}
                >
                  <h3 className="text-base font-bold text-foreground">{bucket.label}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{bucket.description}</p>

                  {/* Placed chips */}
                  <div className="mt-3 min-h-10 space-y-1.5">
                    {placed.length === 0 && !submitted && (
                      <p className="py-2 text-center text-[10px] italic text-muted-foreground/60">
                        {isTarget ? 'Tap here to place' : 'Empty'}
                      </p>
                    )}
                    {placed.map((c) => {
                      const correct = submitted && c.correctBucket === bucket.id
                      const wrong = submitted && c.correctBucket !== bucket.id
                      return (
                        <motion.div
                          key={c.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleUnassign(c.id)
                          }}
                          className={cn(
                            'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all',
                            submitted && correct && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
                            submitted && wrong && 'border-red-500/50 bg-red-500/15 text-red-800 dark:text-red-200',
                            !submitted && cn(style.chipBg, 'cursor-pointer hover:opacity-70')
                          )}
                          title={!submitted ? 'Tap to remove' : undefined}
                        >
                          {submitted && correct && <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />}
                          {submitted && wrong && <XCircle className="size-3.5 shrink-0 text-red-500" />}
                          {c.label}
                          {!submitted && <XCircle className="ml-auto size-3 shrink-0 text-muted-foreground/50" />}
                        </motion.div>
                      )
                    })}
                  </div>
                </motion.button>
              )
            })}
          </div>

          {/* Submit / Result */}
          {!submitted ? (
            <Button
              onClick={() => setSubmitted(true)}
              disabled={!allAssigned}
              size="lg"
              className="w-full gap-2 text-base"
            >
              Submit answers
            </Button>
          ) : (
            <div className="space-y-4">
              <div className={cn(
                'rounded-2xl border p-5 text-center',
                score === game.chips.length
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : score >= game.chips.length * 0.6
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-red-500/40 bg-red-500/10'
              )}>
                <p className="text-3xl font-bold text-foreground">
                  {score}/{game.chips.length}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {score === game.chips.length
                    ? 'Perfect! Every finding in the right bucket.'
                    : score >= game.chips.length * 0.6
                      ? 'Good effort. Review the explanations below for the ones you missed.'
                      : 'Worth re-reading the content. The explanations below will help.'}
                </p>
              </div>

              {/* Detailed explanations */}
              <div className="space-y-2">
                {game.chips.map((c) => {
                  const correct = assignments[c.id] === c.correctBucket
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        'rounded-xl border p-3',
                        correct ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {correct
                          ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                          : <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
                        <div>
                          <p className="text-sm font-bold text-foreground">{c.label}</p>
                          <p className="mt-0.5 text-xs text-foreground/80">{c.explanation}</p>
                          {!correct && (
                            <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-300">
                              Correct bucket: {game.buckets.find((b) => b.id === c.correctBucket)?.label}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <Button onClick={onDone} size="lg" className="w-full gap-2">
                Continue to quiz
                <ArrowRight className="size-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ
// ─────────────────────────────────────────────────────────────────────────────

function QuizSection({
  questions,
  onDone,
}: {
  questions: LearnQuizQuestion[]
  topic: typeof TOPIC_BY_ID[string]
  onDone: () => void
}) {
  const [current, setCurrent] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)

  const q = questions[current]

  const handlePick = (optId: string) => {
    if (revealed) return
    setPicked(optId)
  }

  const handleReveal = () => {
    if (!picked) return
    setRevealed(true)
    if (picked === q.correctId) setScore((s) => s + 1)
  }

  const handleNext = () => {
    if (current < questions.length - 1) {
      setCurrent((c) => c + 1)
      setPicked(null)
      setRevealed(false)
    } else {
      setDone(true)
    }
  }

  if (done) {
    return (
      <Card>
        <CardContent className="space-y-4 py-8 text-center">
          <Star className="mx-auto size-12 text-amber-500" />
          <h2 className="text-2xl font-bold text-foreground">
            {score}/{questions.length} correct
          </h2>
          <p className="text-sm text-muted-foreground">
            {score === questions.length
              ? 'Perfect score! You\'ve got this locked in.'
              : score >= questions.length * 0.6
                ? 'Solid understanding. Review the explanations for the ones you missed.'
                : 'Worth revisiting the reading. Don\'t worry — repetition is how mastery forms.'}
          </p>
          <Button onClick={onDone} className="gap-2">
            Continue to pearls
            <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="size-4 text-teal-600 dark:text-teal-300" />
            Question {current + 1} of {questions.length}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">{score} correct so far</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm font-medium leading-relaxed text-foreground">{q.stem}</p>

        <div className="space-y-2">
          {q.options.map((opt) => {
            const isCorrect = revealed && opt.id === q.correctId
            const isWrong = revealed && opt.id === picked && opt.id !== q.correctId
            const isPicked = picked === opt.id && !revealed
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handlePick(opt.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all',
                  isCorrect && 'border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
                  isWrong && 'border-red-500 bg-red-500/10 text-red-800 dark:text-red-200',
                  isPicked && 'border-teal-500 bg-teal-500/10 ring-2 ring-teal-500/30',
                  !isCorrect && !isWrong && !isPicked && 'border-border hover:border-teal-500/40 hover:bg-muted/30'
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold">
                  {opt.id.toUpperCase()}
                </span>
                <span className="flex-1">{opt.text}</span>
                {isCorrect && <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />}
                {isWrong && <XCircle className="size-5 shrink-0 text-red-500" />}
              </button>
            )
          })}
        </div>

        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
              <Brain className="size-3.5" />
              Explanation
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">{q.explanation}</p>
          </motion.div>
        )}

        <div className="flex justify-end gap-2">
          {!revealed ? (
            <Button onClick={handleReveal} disabled={!picked}>
              Check answer
            </Button>
          ) : (
            <Button onClick={handleNext} className="gap-2">
              {current < questions.length - 1 ? 'Next question' : 'See results'}
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PEARLS
// ─────────────────────────────────────────────────────────────────────────────

function PearlsSection({
  pearls,
  onDone,
}: {
  pearls: Pearl[]
  topic: typeof TOPIC_BY_ID[string]
  onDone: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (pearls.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Sparkles className="mx-auto mb-2 size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No pearls matched this sub-topic. More being authored.</p>
          <Button onClick={onDone} variant="outline" className="mt-4 gap-2">
            Skip to cases <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {pearls.map((p, i) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <Card className="overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              className="w-full text-left"
            >
              <CardContent className="flex items-start gap-3 pt-1">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                  <Sparkles className="size-4 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{p.question}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{p.condition} · {p.difficulty}</p>
                </div>
                <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded === p.id && 'rotate-90')} />
              </CardContent>
            </button>
            {expanded === p.id && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}>
                <div className="border-t px-5 py-4 text-sm leading-relaxed text-foreground/80">
                  <p>{p.answer}</p>
                  {p.mechanism && (
                    <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-300">Mechanism</p>
                      <p className="mt-1 text-xs leading-relaxed">{p.mechanism}</p>
                    </div>
                  )}
                  {p.citation && (
                    <p className="mt-3 text-[10px] text-muted-foreground">
                      <span className="font-semibold">Ref:</span> {p.citation.authors} ({p.citation.year}). <span className="italic">{p.citation.title}</span>. {p.citation.journal}.
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </Card>
        </motion.div>
      ))}
      <div className="flex justify-end">
        <Button onClick={onDone} className="gap-2">
          Continue to cases <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CASES
// ─────────────────────────────────────────────────────────────────────────────

function CasesSection({
  cases,
}: {
  cases: ClinicalCase[]
  topicId: string
  topic: typeof TOPIC_BY_ID[string]
}) {
  if (cases.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Eye className="mx-auto mb-2 size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No cases matched this sub-topic yet.</p>
        </CardContent>
      </Card>
    )
  }

  const diffColor: Record<string, string> = {
    beginner:     'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    intermediate: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    advanced:     'bg-red-500/10 text-red-700 dark:text-red-400',
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Socratic case discussions for this sub-topic. Each case guides you through history, examination, investigation and management with AI-driven dialogue.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cases.map((c, i) => (
          <Link key={c.id} href={`/cases/${c.id}`} className="group block">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileHover={{ y: -2 }}
            >
              <Card className="h-full transition-all hover:border-teal-500/40 hover:shadow-lg">
                <CardContent className="flex flex-col gap-2 pt-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-foreground">{c.title}</h3>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100" />
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Badge variant="secondary" className={cn('text-[10px]', diffColor[c.difficulty] ?? '')}>{c.difficulty}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{c.stages?.length ?? 0} stages</Badge>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </Link>
        ))}
      </div>
    </div>
  )
}

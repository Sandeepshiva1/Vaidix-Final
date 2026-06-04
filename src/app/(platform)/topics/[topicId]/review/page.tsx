'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Sparkles,
  GraduationCap,
  Eye,
  Target,
  AlertTriangle,
  User,
  Users,
  UserCheck,
  CheckCircle2,
  Mic,
  MicOff,
  Stethoscope,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TOPIC_BY_ID } from '@/lib/constants'
import { useRole } from '@/contexts/role-context'
import { PageTransition, motion, AnimatedBar } from '@/lib/motion'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { SpeakButton } from '@/components/shared/speak-button'
import { cn } from '@/lib/utils'
import reviewItemsData from '@/mock-data/review-items.json'
import {
  adaptiveEngine,
  createInitialState,
  updateState,
  type SessionState,
  type NextAction,
} from '@/lib/adaptive-engine'
import { generateReviewItems } from '@/lib/question-generator'
import { captureAnswer, detectNovelty } from '@/lib/training-queue'
import { gradeWithGemini } from '@/lib/gemini-grader'
import { generateSessionSeed, shuffleSeeded } from '@/lib/seeded-random'
import { localPrefilter } from '@/lib/local-prefilter'

type Axis = 'knowledge' | 'reasoning' | 'communication' | 'empathy' | 'relevance' | 'safety'

interface ExplainItem {
  id: string
  topic: string
  subTopic: string
  difficulty: number
  type: 'explain-to'
  audience: 'patient_family' | 'peer' | 'senior'
  patientVoice?: string  // first-person, lived experience (preferred)
  clinicalNote?: string  // your observations as the doctor
  scenario?: string      // legacy / fallback for non-patient items
  prompt: string
  axesScored: Axis[]
  rubric: { good: string[]; poor: string[] }
  modelAnswer: string
}

interface NoiseFilterItem {
  id: string
  topic: string
  subTopic: string
  difficulty: number
  type: 'noise-filter'
  patientVoice?: string
  clinicalNote?: string
  scenario?: string
  history: { text: string; tag: 'relevant' | 'noise' | 'red_flag' }[]
  prompt: string
  axesScored: Axis[]
  rubric: { minRelevant: number; minRedFlag: number }
}

interface RequiredHistoryQuestion {
  id: string
  category: string
  criticality: 'high' | 'medium' | 'low'
  label: string
  keywords: string[]
  whyMatters: string
}

interface HistoryAuditItem {
  id: string
  topic: string
  subTopic: string
  difficulty: number
  type: 'history-audit'
  patientVoice: string
  clinicalNote: string
  task: string
  axesScored: Axis[]
  requiredHistory: RequiredHistoryQuestion[]
}

interface ImageInterpretItem {
  id: string
  topic: string
  subTopic: string
  difficulty: number
  type: 'image-interpret'
  imageUrl: string
  imageAlt: string
  imageCaption: string
  imageSource: string
  patientVoice?: string
  clinicalNote?: string
  prompt: string
  axesScored: Axis[]
  rubric: { good: string[]; poor: string[] }
  modelAnswer: string
}

type ReviewItem = ExplainItem | NoiseFilterItem | HistoryAuditItem | ImageInterpretItem

const ALL_ITEMS = reviewItemsData as ReviewItem[]

const AUDIENCE_CONFIG = {
  patient_family: { icon: User, label: 'Patient / Family', tone: 'Drop jargon. Use analogy.', color: 'text-rose-600', bg: 'bg-rose-500/10', border: 'border-rose-500/30' },
  peer: { icon: Users, label: 'Peer Student', tone: 'Show mechanism. Be precise.', color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  senior: { icon: UserCheck, label: 'Senior Consultant', tone: '30 seconds. Compress. Surface red flags.', color: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
}

const AXIS_CONFIG: Record<Axis, { label: string; icon: LucideIcon; color: string }> = {
  knowledge: { label: 'Knowledge', icon: Brain, color: 'text-blue-500' },
  reasoning: { label: 'Reasoning', icon: Sparkles, color: 'text-purple-500' },
  communication: { label: 'Communication', icon: GraduationCap, color: 'text-amber-500' },
  empathy: { label: 'Empathy', icon: Eye, color: 'text-rose-500' },
  relevance: { label: 'Relevance', icon: Target, color: 'text-emerald-500' },
  safety: { label: 'Safety', icon: AlertTriangle, color: 'text-red-500' },
}

interface AnswerRecord {
  itemId: string
  subTopic: string
  difficulty: number
  axisScores: Partial<Record<Axis, number>>
  isCorrect: boolean
  /** History items the learner failed to ask about (only for history-audit items) */
  missedHistory?: { id: string; label: string; criticality: 'high' | 'medium' | 'low'; whyMatters: string }[]
  /** The actual prompt + learner's full answer text — used by the report coach */
  prompt?: string
  audience?: string
  learnerAnswer?: string
  modelAnswer?: string
}

// ---------------------------------------------------------------------------
// Mock scoring engine
// Scores a free-text answer for an explain-to item across the relevant axes.
// In Phase B this would be replaced by an LLM grader against the rubric.
// ---------------------------------------------------------------------------

function scoreExplainAnswer(item: ExplainItem, answer: string): { axisScores: Partial<Record<Axis, number>>; isCorrect: boolean } {
  const lower = answer.toLowerCase()
  const wordCount = answer.trim().split(/\s+/).length
  const scores: Partial<Record<Axis, number>> = {}

  // Generic floors based on length
  const lengthScore = Math.min(100, Math.max(20, (wordCount / 60) * 100))

  for (const axis of item.axesScored) {
    let s = lengthScore * 0.5

    // Match good rubric terms
    const goodHits = item.rubric.good.filter((g) => lower.includes(g.toLowerCase().split(' ')[0])).length
    const poorHits = item.rubric.poor.filter((p) => lower.includes(p.toLowerCase().split(' ')[0])).length

    s += goodHits * 12
    s -= poorHits * 15

    // Audience-specific heuristics
    if (item.audience === 'patient_family') {
      // Empathy: presence of acknowledging words
      if (axis === 'empathy') {
        if (/scared|understand|know|feel|sorry|here for you|with you|together/i.test(answer)) s += 15
      }
      // Communication: penalize jargon
      if (axis === 'communication') {
        const jargon = (answer.match(/(necrosis|arteritis|vasculitis|granuloma|aetiology|pathogenesis|hypopyon|FFA|OCT|VEGF|CNVM|hyperreflective)/gi) || []).length
        s -= jargon * 8
      }
    }
    if (item.audience === 'peer') {
      // Knowledge & Reasoning: reward mechanism words
      if (axis === 'knowledge' || axis === 'reasoning') {
        if (/mechanism|because|due to|via|pathway|cellular|molecular|receptor|cytokine|complement/i.test(answer)) s += 12
      }
    }
    if (item.audience === 'senior') {
      // Relevance: penalize length over 80 words
      if (axis === 'relevance') {
        if (wordCount > 80) s -= 10
        if (wordCount < 60) s += 10
      }
      // Safety: red flag mention
      if (axis === 'safety') {
        if (/concern|red flag|watch|escalate|urgent|critical/i.test(answer)) s += 12
      }
    }

    scores[axis] = Math.round(Math.max(20, Math.min(100, s)))
  }

  // Overall correctness: average of axis scores >= 65
  const avg = Object.values(scores).reduce((a, b) => a + b!, 0) / item.axesScored.length
  return { axisScores: scores, isCorrect: avg >= 65 }
}

/**
 * History audit scorer.
 * Detects which required history items the learner asked about by keyword match.
 * Critically: surfaces what they MISSED, weighted by criticality.
 *
 * Phase B will replace keyword match with an LLM intent classifier so paraphrases
 * like "any chance you might be expecting?" register as a pregnancy question.
 */
function scoreHistoryAudit(
  item: HistoryAuditItem,
  questions: string
): { axisScores: Partial<Record<Axis, number>>; isCorrect: boolean; missedHistory: AnswerRecord['missedHistory']; coveredIds: string[] } {
  const lower = questions.toLowerCase()
  const covered: string[] = []
  const missed: NonNullable<AnswerRecord['missedHistory']> = []

  for (const req of item.requiredHistory) {
    const hit = req.keywords.some((kw) => lower.includes(kw.toLowerCase()))
    if (hit) {
      covered.push(req.id)
    } else {
      missed.push({ id: req.id, label: req.label, criticality: req.criticality, whyMatters: req.whyMatters })
    }
  }

  // Weighted coverage: high=3, medium=2, low=1
  const weight = (c: 'high' | 'medium' | 'low') => (c === 'high' ? 3 : c === 'medium' ? 2 : 1)
  const totalWeight = item.requiredHistory.reduce((s, r) => s + weight(r.criticality), 0)
  const coveredWeight = item.requiredHistory
    .filter((r) => covered.includes(r.id))
    .reduce((s, r) => s + weight(r.criticality), 0)
  const completeness = Math.round((coveredWeight / totalWeight) * 100)

  // Safety penalty: any HIGH miss caps safety severely
  const highMissed = missed.filter((m) => m.criticality === 'high').length
  const safetyScore = Math.max(20, 100 - highMissed * 25)

  // Knowledge inferred from breadth across categories
  const categoriesCovered = new Set(item.requiredHistory.filter((r) => covered.includes(r.id)).map((r) => r.category)).size
  const totalCategories = new Set(item.requiredHistory.map((r) => r.category)).size
  const knowledgeScore = Math.round((categoriesCovered / totalCategories) * 100)

  return {
    axisScores: {
      relevance: completeness,
      safety: safetyScore,
      knowledge: knowledgeScore,
    },
    isCorrect: completeness >= 70 && highMissed === 0,
    missedHistory: missed,
    coveredIds: covered,
  }
}

function scoreNoiseFilter(item: NoiseFilterItem, tags: Record<number, 'relevant' | 'noise' | 'red_flag' | null>): { axisScores: Partial<Record<Axis, number>>; isCorrect: boolean } {
  let correct = 0
  const total = item.history.length
  item.history.forEach((h, i) => {
    if (tags[i] === h.tag) correct++
  })
  const accuracy = (correct / total) * 100

  // Safety = how well red flags were caught
  const redFlagsTotal = item.history.filter((h) => h.tag === 'red_flag').length
  const redFlagsCaught = item.history.filter((h, i) => h.tag === 'red_flag' && tags[i] === 'red_flag').length
  const safetyScore = redFlagsTotal > 0 ? (redFlagsCaught / redFlagsTotal) * 100 : 100

  return {
    axisScores: {
      relevance: Math.round(accuracy),
      safety: Math.round(safetyScore),
    },
    isCorrect: accuracy >= 70 && redFlagsCaught === redFlagsTotal,
  }
}

// ---------------------------------------------------------------------------
// Engagement helpers — verdict microcopy + streak tracker + type metadata
// used by the inter-question transition card.
// ---------------------------------------------------------------------------

/**
 * Compute the current "solid answers in a row" streak from the answer history.
 * Resets on any answer where isCorrect is false.
 */
function computeStreak(records: AnswerRecord[]): number {
  let streak = 0
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].isCorrect) streak++
    else break
  }
  return streak
}

/**
 * Build a short, varied acknowledgment for the learner's previous answer.
 * Tone matches the performance so we don't congratulate a weak answer or
 * sound curt about a strong one.
 */
function buildAcknowledgment(
  avgScore: number,
  streak: number
): { headline: string; sub: string; tone: 'strong' | 'ok' | 'gentle' } {
  // Seeded by streak so consecutive messages vary
  const strongLines = [
    { h: 'Clean answer.', s: 'Crisp reasoning — this is the tempo we want.' },
    { h: 'Nailed it.', s: 'You moved through the findings like you\'ve seen this before.' },
    { h: 'Strong.', s: 'Structure, safety, plan — all there.' },
    { h: 'Solid.', s: 'That\'s the kind of answer a senior wants at 2 AM.' },
  ]
  const okLines = [
    { h: 'Good — keeping pace.', s: 'The bones are there. Let\'s keep building.' },
    { h: 'Not bad.', s: 'You got the main beats. Next one will sharpen the edges.' },
    { h: 'Decent momentum.', s: 'Hold onto the structure you used there.' },
  ]
  const gentleLines = [
    { h: 'Noted — moving on.', s: 'You\'ll see this pattern again. The next one gives you another shot.' },
    { h: 'Alright.', s: 'Don\'t stall. Keep the flow going — we\'ll revisit this in the report.' },
    { h: 'Keep going.', s: 'One answer doesn\'t define the session. Let\'s see the next.' },
  ]

  if (avgScore >= 75) {
    const pick = strongLines[streak % strongLines.length]
    const withStreak = streak >= 3 ? `${pick.h} · ${streak} in a row` : pick.h
    return { headline: withStreak, sub: pick.s, tone: 'strong' }
  }
  if (avgScore >= 55) {
    const pick = okLines[streak % okLines.length]
    return { headline: pick.h, sub: pick.s, tone: 'ok' }
  }
  const pick = gentleLines[streak % gentleLines.length]
  return { headline: pick.h, sub: pick.s, tone: 'gentle' }
}

/** Human label + icon + narrative for each item type, shown on the transition card. */
const TYPE_META: Record<
  ReviewItem['type'],
  { label: string; icon: LucideIcon; color: string; bg: string; border: string; pitch: (sub: string) => string }
> = {
  'explain-to': {
    label: 'Explain it',
    icon: GraduationCap,
    color: 'text-amber-600',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    pitch: (sub) => `Next up — explaining ${sub} to a specific audience. Match the register.`,
  },
  'noise-filter': {
    label: 'Signal vs noise',
    icon: ListChecks,
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    pitch: (sub) => `Shifting gears — a ${sub} case. Tag what's relevant, noise, or a red flag.`,
  },
  'history-audit': {
    label: 'History audit',
    icon: Stethoscope,
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    pitch: (sub) => `Switching it up — take the history for a ${sub} patient. What would you ask?`,
  },
  'image-interpret': {
    label: 'Image reading',
    icon: Eye,
    color: 'text-cyan-600',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    pitch: (sub) => `Eyes on an image — ${sub}. Describe what you see before you jump to a diagnosis.`,
  },
}

// ---------------------------------------------------------------------------
// Main page — uses the adaptive engine from @/lib/adaptive-engine
// ---------------------------------------------------------------------------

export default function TopicReviewPage() {
  const params = useParams<{ topicId: string }>()
  const router = useRouter()
  const topicId = params.topicId
  const topic = TOPIC_BY_ID[topicId]

  // Per-session seed — generated once per mount. Two team members starting
  // the same topic at the same minute get different seeds, so item order +
  // generator output diverge. MUST be declared before `pool` because pool
  // depends on it.
  const [sessionSeed] = useState<number>(() => generateSessionSeed())

  // Hybrid pool: hand-curated static items + runtime-generated items from
  // knowledge atoms, then shuffled with the per-session seed so different
  // team members get different orderings even on the same topic.
  // Engine still picks adaptively from this shuffled pool.
  const pool = useMemo(() => {
    const topicItems = ALL_ITEMS.filter((i) => i.topic === topicId)
    const baseStatic = topicItems.length >= 3 ? topicItems : ALL_ITEMS
    const generated = generateReviewItems({ topic: topicId, count: 8, seed: sessionSeed })
    const merged = [...baseStatic, ...generated] as ReviewItem[]
    return shuffleSeeded(merged, sessionSeed)
  }, [topicId, sessionSeed])
  const [sessionState, setSessionState] = useState<SessionState>(() => createInitialState())
  const [current, setCurrent] = useState<ReviewItem | null>(null)
  const [lastAction, setLastAction] = useState<NextAction | null>(null)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [explainText, setExplainText] = useState('')
  const [historyText, setHistoryText] = useState('')
  const [noiseTags, setNoiseTags] = useState<Record<number, 'relevant' | 'noise' | 'red_flag' | null>>({})
  const [finished, setFinished] = useState(false)
  const [showEngineDetails, setShowEngineDetails] = useState(false)
  const [grading, setGrading] = useState(false)
  const [followUpPrompt, setFollowUpPrompt] = useState<string | null>(null)
  const [followUpType, setFollowUpType] = useState<'clarification' | 'escalation' | null>(null)
  const [previousAnswers, setPreviousAnswers] = useState<string[]>([])
  const [followUpDepth, setFollowUpDepth] = useState(0) // 0 = first try, 1 = first follow-up, 2 = second follow-up
  const MAX_FOLLOWUPS = 2

  // Transition interlude — shown briefly between questions. Gives the learner
  // a moment to breathe, celebrates their previous answer, and narrates what's
  // coming next so the experience feels guided instead of whiplashing.
  const [transition, setTransition] = useState<{
    acknowledgment: { headline: string; sub: string; tone: 'strong' | 'ok' | 'gentle' }
    next: ReviewItem
    streak: number
  } | null>(null)

  const { isSupported: speechSupported, isListening, transcript, interimTranscript, secondsLeft: voiceSecondsLeft, maxDurationSeconds: voiceMaxSeconds, toggle: toggleListen, reset: resetSpeech } = useSpeechRecognition({ lang: 'en-IN', maxDurationMs: 30_000 })

  // Pick first item on mount via the adaptive engine
  useEffect(() => {
    if (!current && !finished && answers.length === 0) {
      const action = adaptiveEngine(sessionState, pool, sessionSeed)
      setLastAction(action)
      if (action.action === 'continue' && action.item) {
        setCurrent(action.item as ReviewItem)
      } else {
        setFinished(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])

  // Merge live speech into the active textarea (explain or history)
  useEffect(() => {
    if (!isListening && !transcript && !interimTranscript) return
    const live = (transcript + ' ' + interimTranscript).trim()
    if (!live) return
    if (current?.type === 'history-audit') setHistoryText(live)
    else setExplainText(live)
  }, [transcript, interimTranscript, isListening, current])

  if (!topic) {
    return <div className="py-12 text-center text-muted-foreground">Topic not found.</div>
  }

  const questionNumber = answers.length + 1
  const meta = lastAction?.metadata
  const minQ = meta?.minQuestions ?? 6
  const maxQ = meta?.maxQuestions ?? 20
  const progress = meta?.progressEstimate ? meta.progressEstimate * 100 : (answers.length / 12) * 100

  /**
   * Async submit handler — three-stage adaptive grading.
   *
   * Stage 1: Local pre-filter
   *   Catches obvious vague/garbage/off-topic answers without burning a
   *   Gemini call. If pre-filter fires, ask a clarifying follow-up
   *   immediately.
   *
   * Stage 2: Gemini grader
   *   For substantive answers, call Gemini and read the verdict:
   *     - vague    → ask clarification (uses up a follow-up slot)
   *     - shallow  → ask escalation (uses up a follow-up slot, only if
   *                  follow-up budget remains)
   *     - solid    → score and advance
   *
   * Stage 3: Heuristic fallback
   *   If both pre-filter and Gemini are unavailable, fall back to the
   *   rule-based scorer.
   *
   * Follow-up budget: max 2 follow-ups per question (so 3 turns total).
   * After the budget is exhausted, the answer is scored as-is.
   *
   * All turns of one question are blended into a single set of axis scores.
   */
  const handleSubmitAndAdvance = async () => {
    if (!current || grading) return

    let scored: {
      axisScores: Partial<Record<Axis, number>>
      isCorrect: boolean
      modelAnswer?: string
      missedHistory?: AnswerRecord['missedHistory']
    } | null = null

    setGrading(true)
    try {
      if (current.type === 'explain-to') {
        if (!explainText.trim()) return

        // STAGE 1: Local pre-filter (only on first turn — follow-ups are
        // assumed to be substantive responses to a specific prompt)
        if (followUpDepth === 0) {
          const pre = localPrefilter(explainText)
          if (pre.shouldSkipGemini && pre.followUp && followUpDepth < MAX_FOLLOWUPS) {
            setFollowUpPrompt(pre.followUp)
            setFollowUpType('clarification')
            setPreviousAnswers([explainText])
            setFollowUpDepth(1)
            setExplainText('')
            resetSpeech()
            setGrading(false)
            return
          }
        }

        // STAGE 2: Gemini grader
        // For follow-up turns, send the full transcript so Gemini scores
        // the chained answer as one blended response.
        const fullAnswer =
          previousAnswers.length > 0
            ? previousAnswers.map((a, i) => `[Turn ${i + 1}] ${a}`).join('\n\n') + `\n\n[Turn ${previousAnswers.length + 1}] ${explainText}`
            : explainText

        const gemini = await gradeWithGemini({
          audience: current.audience,
          scenario: (current.patientVoice || current.scenario) ?? '',
          prompt: current.prompt,
          axesScored: current.axesScored,
          rubric: current.rubric,
          modelAnswer: current.modelAnswer,
          learnerAnswer: fullAnswer,
          isFollowUp: followUpDepth > 0,
          previousAnswer: previousAnswers.join('\n\n'),
        })

        // Gemini verdict handling
        if (gemini && gemini.followUpQuestion && followUpDepth < MAX_FOLLOWUPS) {
          // vague → clarification, shallow → escalation
          // Only escalate if follow-up budget remains (already checked) AND
          // the engine considers this axis worth probing more (we trust Gemini
          // here since it knows the answer content; the engine is structural).
          setFollowUpPrompt(gemini.followUpQuestion)
          setFollowUpType(gemini.followUpType ?? 'clarification')
          setPreviousAnswers([...previousAnswers, explainText])
          setFollowUpDepth(followUpDepth + 1)
          setExplainText('')
          resetSpeech()
          setGrading(false)
          return
        }

        // Verdict was solid OR follow-up budget exhausted → score and advance
        if (gemini && Object.keys(gemini.axisScores).length > 0) {
          scored = {
            axisScores: gemini.axisScores,
            isCorrect: gemini.overallVerdict === 'strong',
            modelAnswer: current.modelAnswer,
          }
        } else {
          // STAGE 3: Heuristic fallback
          const r = scoreExplainAnswer(current, explainText)
          scored = { ...r, modelAnswer: current.modelAnswer }
        }
      } else if (current.type === 'noise-filter') {
        if (Object.keys(noiseTags).length < current.history.length) return
        scored = scoreNoiseFilter(current, noiseTags)
      } else if (current.type === 'history-audit') {
        if (!historyText.trim()) return
        scored = scoreHistoryAudit(current, historyText)
      } else if (current.type === 'image-interpret') {
        if (!explainText.trim()) return
        // Image items use the same Gemini grader; the prompt context tells
        // the grader an image was shown.
        const gemini = await gradeWithGemini({
          audience: 'peer',
          scenario: `${current.patientVoice ?? ''}\n[Resident is also viewing the fundus image: ${current.imageCaption}]`,
          prompt: current.prompt,
          axesScored: current.axesScored,
          rubric: current.rubric,
          modelAnswer: current.modelAnswer,
          learnerAnswer: explainText,
        })
        if (gemini && Object.keys(gemini.axisScores).length > 0) {
          scored = {
            axisScores: gemini.axisScores,
            isCorrect: gemini.overallVerdict === 'strong',
            modelAnswer: current.modelAnswer,
          }
        } else {
          // Heuristic fallback for image items
          const lower = explainText.toLowerCase()
          const goodHits = current.rubric.good.filter((g) => lower.includes(g.toLowerCase().split(' ')[0])).length
          const total = current.rubric.good.length
          const score = Math.min(100, Math.max(20, Math.round((goodHits / Math.max(1, total)) * 110)))
          const axisScores: Partial<Record<Axis, number>> = {}
          current.axesScored.forEach((a) => (axisScores[a] = score))
          scored = {
            axisScores,
            isCorrect: score >= 65,
            modelAnswer: current.modelAnswer,
          }
        }
      }
    } finally {
      setGrading(false)
    }

    if (!scored) return

    // (Follow-up state is reset further down before the engine picks the
    // next item, since we know we're moving on)

    // Novelty detection — should we capture this for ML training?
    const avgScore =
      Object.values(scored.axisScores).reduce((s, v) => s + (v ?? 0), 0) /
      Math.max(1, Object.keys(scored.axisScores).length)

    let noveltyResult: { flags: ReturnType<typeof detectNovelty>['flags']; confidence: number } = {
      flags: [],
      confidence: 1,
    }

    if (current.type === 'explain-to') {
      const lower = explainText.toLowerCase()
      const goodHits = current.rubric.good.filter((g) =>
        lower.includes(g.toLowerCase().split(' ')[0])
      ).length
      const poorHits = current.rubric.poor.filter((p) =>
        lower.includes(p.toLowerCase().split(' ')[0])
      ).length
      noveltyResult = detectNovelty({
        type: 'explain-to',
        answer: explainText,
        goodHits,
        poorHits,
        goodTotal: current.rubric.good.length,
        poorTotal: current.rubric.poor.length,
        audience: current.audience,
        expectedWordsMin: current.audience === 'senior' ? 30 : 50,
        expectedWordsMax: current.audience === 'senior' ? 80 : 150,
        difficulty: current.difficulty,
        finalScore: avgScore,
      })
    } else if (current.type === 'history-audit') {
      const coveredCount = (scored as { coveredIds?: string[] }).coveredIds?.length ?? 0
      noveltyResult = detectNovelty({
        type: 'history-audit',
        answer: historyText,
        coveredCount,
        totalRequired: current.requiredHistory.length,
        difficulty: current.difficulty,
        finalScore: avgScore,
      })
    } else if (current.type === 'noise-filter') {
      noveltyResult = detectNovelty({
        type: 'noise-filter',
        accuracy: avgScore,
        difficulty: current.difficulty,
        finalScore: avgScore,
      })
    }

    if (noveltyResult.flags.length > 0) {
      captureAnswer({
        itemId: current.id,
        itemTopic: current.topic,
        itemSubTopic: current.subTopic,
        itemType: current.type,
        itemDifficulty: current.difficulty,
        audience: current.type === 'explain-to' ? current.audience : undefined,
        rawAnswer:
          current.type === 'noise-filter'
            ? noiseTags
            : current.type === 'history-audit'
              ? historyText
              : explainText,
        engineScore: {
          axisScores: scored.axisScores,
          isCorrect: scored.isCorrect,
          confidence: noveltyResult.confidence,
        },
        noveltyFlags: noveltyResult.flags,
        sessionContext: {
          role: 'resident',
          questionsAnsweredBefore: answers.length,
          thetaAtCapture: sessionState.theta,
        },
      })
    }

    // Build the full answer text the report coach will use
    // For explain-to / image-interpret with follow-ups, blend turns
    const fullAnswerText =
      current.type === 'explain-to' || current.type === 'image-interpret'
        ? previousAnswers.length > 0
          ? [...previousAnswers, explainText].join(' / ')
          : explainText
        : current.type === 'history-audit'
          ? historyText
          : Object.entries(noiseTags)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')

    const itemPrompt =
      current.type === 'explain-to' || current.type === 'image-interpret' || current.type === 'history-audit'
        ? (current as { prompt?: string; task?: string }).prompt ?? (current as { task?: string }).task ?? ''
        : ''
    const itemAudience = current.type === 'explain-to' ? current.audience : undefined
    const itemModelAnswer =
      'modelAnswer' in current ? (current as { modelAnswer?: string }).modelAnswer : undefined

    // Record silently
    const record: AnswerRecord = {
      itemId: current.id,
      subTopic: current.subTopic,
      difficulty: current.difficulty,
      axisScores: scored.axisScores,
      isCorrect: scored.isCorrect,
      missedHistory: scored.missedHistory,
      prompt: itemPrompt,
      audience: itemAudience,
      learnerAnswer: fullAnswerText,
      modelAnswer: itemModelAnswer,
    }
    const newAnswers = [...answers, record]
    setAnswers(newAnswers)

    // Update engine state with this answer
    const newState = updateState(sessionState, current, {
      axisScores: scored.axisScores,
      isCorrect: scored.isCorrect,
      missedHistory: scored.missedHistory,
    })
    setSessionState(newState)

    // Reset UI state — including the follow-up chain since we're moving on
    setExplainText('')
    setHistoryText('')
    setNoiseTags({})
    resetSpeech()
    setFollowUpPrompt(null)
    setFollowUpType(null)
    setPreviousAnswers([])
    setFollowUpDepth(0)

    // Ask the engine: continue or finish?
    const action = adaptiveEngine(newState, pool, sessionSeed)
    setLastAction(action)
    if (action.action === 'finish' || !action.item) {
      setFinished(true)
      setCurrent(null)
    } else {
      // Instead of jumping straight to the next question, show a short
      // transition interlude so the experience feels guided and gives
      // the learner a breath between cases.
      const nextItem = action.item as ReviewItem
      const streak = computeStreak(newAnswers)
      setTransition({
        acknowledgment: buildAcknowledgment(avgScore, streak),
        next: nextItem,
        streak,
      })
      // Hide the current question while the interlude is showing
      setCurrent(null)
    }
  }

  // Called from the transition card "Continue" button — swaps in the next item
  const advanceFromTransition = () => {
    if (!transition) return
    setCurrent(transition.next)
    setTransition(null)
  }

  // Called from the header "Finish & see report" button — early-exit for demos
  // and impatient learners. Terminates with whatever answers are already in.
  const handleFinishEarly = () => {
    if (answers.length === 0) {
      // Nothing answered yet — just exit to topic page
      router.push(`/topics/${topicId}`)
      return
    }
    setTransition(null)
    setCurrent(null)
    setFinished(true)
  }

  // ============== FINISHED — render report ==============
  if (finished) {
    return <ReviewReport topicId={topicId} topicLabel={topic.label} answers={answers} sessionState={sessionState} />
  }

  // ============== TRANSITION INTERLUDE ==============
  // Short "breathing" moment between questions — celebrates the previous
  // answer and narrates what's coming next.
  if (transition) {
    return (
      <PageTransition className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/topics/${topicId}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Exit review
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={handleFinishEarly}
            className="gap-1.5"
          >
            <CheckCircle2 className="size-3.5" />
            Finish &amp; see report
          </Button>
        </div>
        <TransitionCard
          data={transition}
          questionNumber={questionNumber}
          onContinue={advanceFromTransition}
        />
      </PageTransition>
    )
  }

  if (!current) {
    return (
      <PageTransition className="space-y-4 py-12 text-center">
        <p className="text-muted-foreground">Preparing your review...</p>
      </PageTransition>
    )
  }

  // ============== ACTIVE QUESTION ==============

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/topics/${topicId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Exit review
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Question {questionNumber} <span className="text-muted-foreground/50">· adaptive ({minQ}–{maxQ})</span>
          </span>
          {answers.length >= 2 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleFinishEarly}
              className="h-7 gap-1.5 text-xs"
              title="Wrap up early and jump to the report"
            >
              <CheckCircle2 className="size-3.5" />
              Finish &amp; see report
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div>
        <AnimatedBar value={progress} barClassName="bg-rose-500" className="h-1.5" />
      </div>

      {/* Engine intelligence strip — the "ML role" made visible */}
      {meta && (
        <button
          type="button"
          onClick={() => setShowEngineDetails((s) => !s)}
          className="w-full rounded-xl border border-purple-200 bg-linear-to-r from-purple-50 to-blue-50 p-2.5 text-left transition hover:border-purple-300 dark:border-purple-500/20 dark:from-purple-950/20 dark:to-blue-950/20"
        >
          <div className="flex items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-purple-500/15">
              <Brain className="size-3.5 text-purple-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Why this question?</p>
              <p className="truncate text-[11px] text-foreground">{lastAction?.reason}</p>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{showEngineDetails ? 'Hide' : 'Show'} engine</span>
          </div>

          {showEngineDetails && (
            <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-purple-200/50 pt-2.5 sm:grid-cols-4 dark:border-purple-500/20">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">θ (ability)</p>
                <p className="text-sm font-bold tabular-nums text-foreground">{meta.theta.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Target diff</p>
                <p className="text-sm font-bold tabular-nums text-foreground">{Math.round(meta.targetDifficulty * 100)}%</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</p>
                <p className="text-sm font-bold capitalize text-foreground">{meta.confidence}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Targeting</p>
                <p className="text-sm font-bold capitalize text-foreground">{meta.weakestAxis ?? '—'}</p>
              </div>
            </div>
          )}
        </button>
      )}

      <p className="text-[10px] text-muted-foreground">
        Sub-topic: <span className="font-medium text-foreground">{current.subTopic}</span> · Item difficulty: {Math.round(current.difficulty * 100)}%
      </p>

      {/* EXPLAIN-TO ITEM */}
      {current.type === 'explain-to' && (
        <ExplainItemCard
          key={current.id}
          item={current}
          text={explainText}
          onTextChange={setExplainText}
          isListening={isListening}
          voiceSecondsLeft={voiceSecondsLeft}
          voiceMaxSeconds={voiceMaxSeconds}
          speechSupported={speechSupported}
          onToggleListen={toggleListen}
          onSubmit={handleSubmitAndAdvance}
          isLastQuestion={questionNumber >= maxQ}
          grading={grading}
          followUpPrompt={followUpPrompt}
          followUpType={followUpType}
          previousAnswers={previousAnswers}
          followUpDepth={followUpDepth}
        />
      )}

      {/* NOISE FILTER ITEM */}
      {current.type === 'noise-filter' && (
        <NoiseFilterCard
          key={current.id}
          item={current}
          tags={noiseTags}
          onTagsChange={setNoiseTags}
          onSubmit={handleSubmitAndAdvance}
          isLastQuestion={questionNumber >= maxQ}
        />
      )}

      {/* HISTORY AUDIT ITEM */}
      {current.type === 'history-audit' && (
        <HistoryAuditCard
          key={current.id}
          item={current}
          text={historyText}
          onTextChange={setHistoryText}
          isListening={isListening}
          voiceSecondsLeft={voiceSecondsLeft}
          voiceMaxSeconds={voiceMaxSeconds}
          speechSupported={speechSupported}
          onToggleListen={toggleListen}
          onSubmit={handleSubmitAndAdvance}
          isLastQuestion={questionNumber >= maxQ}
        />
      )}

      {/* IMAGE INTERPRET ITEM */}
      {current.type === 'image-interpret' && (
        <ImageInterpretCard
          key={current.id}
          item={current}
          text={explainText}
          onTextChange={setExplainText}
          isListening={isListening}
          voiceSecondsLeft={voiceSecondsLeft}
          voiceMaxSeconds={voiceMaxSeconds}
          speechSupported={speechSupported}
          onToggleListen={toggleListen}
          onSubmit={handleSubmitAndAdvance}
          isLastQuestion={questionNumber >= maxQ}
          grading={grading}
        />
      )}
    </PageTransition>
  )
}

// ---------------------------------------------------------------------------
// Transition card — the interlude between questions. Celebrates the previous
// answer, shows streak, then narrates what's coming next.
// ---------------------------------------------------------------------------

function TransitionCard({
  data,
  questionNumber,
  onContinue,
}: {
  data: {
    acknowledgment: { headline: string; sub: string; tone: 'strong' | 'ok' | 'gentle' }
    next: ReviewItem
    streak: number
  }
  questionNumber: number
  onContinue: () => void
}) {
  const { acknowledgment, next, streak } = data
  const typeMeta = TYPE_META[next.type]
  const NextIcon = typeMeta.icon

  const toneStyles = {
    strong:  { ring: 'ring-emerald-500/30', chipBg: 'bg-emerald-500/10', chipText: 'text-emerald-600 dark:text-emerald-300', accent: 'from-emerald-500 to-teal-500' },
    ok:      { ring: 'ring-blue-500/25',    chipBg: 'bg-blue-500/10',    chipText: 'text-blue-600 dark:text-blue-300',     accent: 'from-blue-500 to-cyan-500' },
    gentle:  { ring: 'ring-amber-500/25',   chipBg: 'bg-amber-500/10',   chipText: 'text-amber-600 dark:text-amber-300',   accent: 'from-amber-500 to-rose-500' },
  }[acknowledgment.tone]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn('relative overflow-hidden rounded-3xl border bg-card p-6 shadow-lg ring-1 sm:p-8', toneStyles.ring)}
    >
      {/* Decorative gradient blob */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 0.5, scale: 1 }}
        transition={{ duration: 0.8 }}
        className={cn('pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-linear-to-br blur-3xl', toneStyles.accent)}
      />

      <div className="relative space-y-5">
        {/* Acknowledgment */}
        <div>
          <div className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider', toneStyles.chipBg, toneStyles.chipText)}>
            <CheckCircle2 className="size-3" />
            Answer {questionNumber - 1} logged
          </div>
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          >
            {acknowledgment.headline}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            className="mt-1 text-sm text-muted-foreground"
          >
            {acknowledgment.sub}
          </motion.p>

          {streak >= 2 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.35, type: 'spring', stiffness: 250 }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-bold text-orange-600 dark:text-orange-300"
            >
              <Sparkles className="size-3" />
              {streak}-answer streak
            </motion.div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-linear-to-r from-transparent via-border to-transparent" />

        {/* Next up */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next up</p>
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className={cn('mt-2 flex items-start gap-3 rounded-2xl border p-3', typeMeta.border, typeMeta.bg)}
          >
            <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl bg-background ring-1 ring-border')}>
              <NextIcon className={cn('size-5', typeMeta.color)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn('text-xs font-bold uppercase tracking-wider', typeMeta.color)}>{typeMeta.label}</span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[11px] font-medium text-foreground">{next.subTopic}</span>
              </div>
              <p className="mt-0.5 text-sm text-foreground">{typeMeta.pitch(next.subTopic)}</p>
            </div>
          </motion.div>
        </div>

        {/* Continue button */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.4 }}
          className="flex items-center justify-between gap-3 pt-1"
        >
          <p className="text-[11px] text-muted-foreground">
            Take a breath. When you&apos;re ready —
          </p>
          <Button
            onClick={onContinue}
            className="gap-2 bg-linear-to-r from-teal-600 to-blue-600 text-white shadow-md shadow-teal-500/25 hover:from-teal-600 hover:to-blue-700"
          >
            Continue
            <ArrowRight className="size-4" />
          </Button>
        </motion.div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Explain-To question card
// ---------------------------------------------------------------------------

function ExplainItemCard({
  item,
  text,
  onTextChange,
  isListening,
  voiceSecondsLeft,
  voiceMaxSeconds,
  speechSupported,
  onToggleListen,
  onSubmit,
  isLastQuestion,
  grading,
  followUpPrompt,
  followUpType,
  previousAnswers,
}: {
  item: ExplainItem
  text: string
  onTextChange: (v: string) => void
  isListening: boolean
  voiceSecondsLeft: number
  voiceMaxSeconds: number
  speechSupported: boolean
  onToggleListen: () => void
  onSubmit: () => void
  isLastQuestion: boolean
  grading: boolean
  followUpPrompt: string | null
  followUpType: 'clarification' | 'escalation' | null
  previousAnswers: string[]
  followUpDepth: number
}) {
  const audience = AUDIENCE_CONFIG[item.audience]
  const AudienceIcon = audience.icon
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const isFollowUpTurn = followUpPrompt !== null

  // Two visual themes for follow-ups:
  //   clarification = purple ("let me make sure I understood")
  //   escalation    = amber  ("OK, now make this harder")
  const isEscalation = followUpType === 'escalation'
  const followBoxClass = isEscalation
    ? 'rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-950/20'
    : 'rounded-lg border border-purple-300 bg-purple-50 p-3 dark:border-purple-500/30 dark:bg-purple-950/20'
  const followIconClass = isEscalation ? 'text-amber-600' : 'text-purple-600'
  const followLabelClass = isEscalation
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-purple-700 dark:text-purple-300'
  const followLabel = isEscalation ? 'Going deeper' : 'Quick clarification'

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={cn('border-2', audience.border)}>
        <CardContent className="space-y-4 pt-1">
          {/* Audience banner */}
          <div className={cn('flex items-center gap-3 rounded-xl border p-3', audience.bg, audience.border)}>
            <div className="flex size-10 items-center justify-center rounded-lg bg-background">
              <AudienceIcon className={cn('size-5', audience.color)} />
            </div>
            <div>
              <p className={cn('text-xs font-semibold uppercase tracking-wider', audience.color)}>Explain to</p>
              <p className="text-sm font-bold text-foreground">{audience.label}</p>
              <p className="text-[11px] italic text-muted-foreground">{audience.tone}</p>
            </div>
          </div>

          {/* Scenario — patient voice + clinical note when available */}
          <ScenarioBlock
            patientVoice={item.patientVoice}
            clinicalNote={item.clinicalNote}
            scenario={item.scenario}
          />

          {/* Prompt */}
          <div>
            <p className="text-sm font-semibold text-foreground">{item.prompt}</p>
          </div>

          {/* Show prior turns + the follow-up prompt when in any follow-up mode */}
          {isFollowUpTurn && previousAnswers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
            >
              {previousAnswers.map((prev, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Your turn {i + 1}
                  </p>
                  <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{prev}&rdquo;</p>
                </div>
              ))}
              <div className={followBoxClass}>
                <div className="flex items-start gap-2">
                  <Brain className={cn('mt-0.5 size-4 shrink-0', followIconClass)} />
                  <div className="flex-1">
                    <p className={cn('text-[10px] font-semibold uppercase tracking-wider', followLabelClass)}>
                      {followLabel}
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">{followUpPrompt}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Textarea + voice */}
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder={isFollowUpTurn ? 'Answer the follow-up question above...' : 'Type your answer or tap the mic to speak...'}
              rows={5}
              className="resize-none rounded-xl"
              disabled={grading}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">{wordCount} words</span>
              <div className="flex gap-2">
                {speechSupported && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isListening ? 'default' : 'outline'}
                    onClick={onToggleListen}
                    disabled={grading}
                    className={cn('gap-1.5', isListening && 'bg-red-500 text-white hover:bg-red-600')}
                  >
                    {isListening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                    {isListening ? `Stop (${voiceSecondsLeft}s)` : `Speak (max ${voiceMaxSeconds}s)`}
                  </Button>
                )}
                <Button onClick={onSubmit} disabled={!text.trim() || grading} className="gap-1.5">
                  {grading ? (
                    <>
                      <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Grading...
                    </>
                  ) : isLastQuestion && !isFollowUpTurn ? (
                    <>Submit &amp; See Report <ArrowRight className="size-3.5" /></>
                  ) : isFollowUpTurn ? (
                    <>Submit Follow-up <ArrowRight className="size-3.5" /></>
                  ) : (
                    <>Submit &amp; Continue <ArrowRight className="size-3.5" /></>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// ScenarioBlock — renders patient voice (lived language) and clinical note (your obs)
// ---------------------------------------------------------------------------

function ScenarioBlock({
  patientVoice,
  clinicalNote,
  scenario,
}: {
  patientVoice?: string
  clinicalNote?: string
  scenario?: string
}) {
  // Legacy items only have `scenario`
  if (!patientVoice && !clinicalNote && scenario) {
    return (
      <div className="rounded-xl bg-muted/40 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scenario</p>
        <p className="mt-1 text-sm leading-relaxed text-foreground">{scenario}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {patientVoice && (
        <div className="relative rounded-xl border-l-4 border-rose-400 bg-rose-50/40 p-4 dark:bg-rose-950/20">
          <div className="mb-1 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <User className="size-3.5 text-rose-600" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">The patient says</p>
            </div>
            <SpeakButton text={patientVoice} />
          </div>
          <p className="text-sm italic leading-relaxed text-foreground">&ldquo;{patientVoice}&rdquo;</p>
        </div>
      )}
      {clinicalNote && (
        <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
          <div className="mb-1 flex items-center gap-1.5">
            <Stethoscope className="size-3.5 text-muted-foreground" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your clinical observations</p>
          </div>
          <p className="font-mono text-xs leading-relaxed text-muted-foreground">{clinicalNote}</p>
        </div>
      )}
      {scenario && !patientVoice && (
        <div className="rounded-xl bg-muted/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scenario</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{scenario}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Noise filter question card
// ---------------------------------------------------------------------------

function NoiseFilterCard({
  item,
  tags,
  onTagsChange,
  onSubmit,
  isLastQuestion,
}: {
  item: NoiseFilterItem
  tags: Record<number, 'relevant' | 'noise' | 'red_flag' | null>
  onTagsChange: (t: Record<number, 'relevant' | 'noise' | 'red_flag' | null>) => void
  onSubmit: () => void
  isLastQuestion: boolean
}) {
  const allTagged = Object.keys(tags).length === item.history.length

  const tagColors = {
    relevant: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    noise: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
    red_flag: 'bg-red-500/10 text-red-600 border-red-500/30',
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-2 border-emerald-500/30">
        <CardContent className="space-y-4 pt-1">
          {/* Banner */}
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-background">
              <Target className="size-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Signal vs Noise</p>
              <p className="text-sm font-bold text-foreground">Tag each statement</p>
              <p className="text-[11px] italic text-muted-foreground">Real OPDs are full of irrelevant detail. Find the signal.</p>
            </div>
          </div>

          {/* Scenario — patient voice + clinical note */}
          <ScenarioBlock
            patientVoice={item.patientVoice}
            clinicalNote={item.clinicalNote}
            scenario={item.scenario}
          />

          {/* History items */}
          <div className="space-y-2">
            {item.history.map((h, i) => {
              const userTag = tags[i]
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border/50 p-2"
                >
                  <p className="flex-1 text-sm text-foreground">{h.text}</p>
                  <div className="flex shrink-0 gap-1">
                    {(['relevant', 'noise', 'red_flag'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onTagsChange({ ...tags, [i]: t })}
                        className={cn(
                          'rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize transition',
                          userTag === t ? tagColors[t] : 'border-border/40 text-muted-foreground hover:border-border'
                        )}
                      >
                        {t === 'red_flag' ? 'Red Flag' : t}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <Button onClick={onSubmit} disabled={!allTagged} className="w-full gap-1.5">
            {isLastQuestion ? 'Submit & See Report' : 'Submit & Continue'}
            <ArrowRight className="size-3.5" />
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// History Audit card — tests what the doctor FAILED to ask
// ---------------------------------------------------------------------------

function HistoryAuditCard({
  item,
  text,
  onTextChange,
  isListening,
  voiceSecondsLeft,
  voiceMaxSeconds,
  speechSupported,
  onToggleListen,
  onSubmit,
  isLastQuestion,
}: {
  item: HistoryAuditItem
  text: string
  onTextChange: (v: string) => void
  isListening: boolean
  voiceSecondsLeft: number
  voiceMaxSeconds: number
  speechSupported: boolean
  onToggleListen: () => void
  onSubmit: () => void
  isLastQuestion: boolean
}) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-2 border-indigo-500/30">
        <CardContent className="space-y-4 pt-1">
          {/* Banner */}
          <div className="flex items-center gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-background">
              <ListChecks className="size-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">History Audit</p>
              <p className="text-sm font-bold text-foreground">What did you forget to ask?</p>
              <p className="text-[11px] italic text-muted-foreground">
                The most dangerous clinical errors are omissions. List the questions you would ask.
              </p>
            </div>
          </div>

          {/* Scenario */}
          <ScenarioBlock
            patientVoice={item.patientVoice}
            clinicalNote={item.clinicalNote}
          />

          {/* Task */}
          <div>
            <p className="text-sm font-semibold text-foreground">{item.task}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Type or speak the questions you would ask the patient. List them naturally — &ldquo;Are you on any blood thinners? Do you have a family history of glaucoma? Any recent eye trauma?&rdquo;
            </p>
          </div>

          {/* Answer area */}
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Type the questions you would ask, separated by line breaks or natural sentences..."
              rows={6}
              className="resize-none rounded-xl"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">{wordCount} words</span>
              <div className="flex gap-2">
                {speechSupported && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isListening ? 'default' : 'outline'}
                    onClick={onToggleListen}
                    className={cn('gap-1.5', isListening && 'bg-red-500 text-white hover:bg-red-600')}
                  >
                    {isListening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                    {isListening ? `Stop (${voiceSecondsLeft}s)` : `Speak (max ${voiceMaxSeconds}s)`}
                  </Button>
                )}
                <Button onClick={onSubmit} disabled={!text.trim()} className="gap-1.5">
                  {isLastQuestion ? 'Submit & See Report' : 'Submit & Continue'}
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Image Interpret card — fundus / OCT / FFA images with free-text response
// ---------------------------------------------------------------------------

function ImageInterpretCard({
  item,
  text,
  onTextChange,
  isListening,
  voiceSecondsLeft,
  voiceMaxSeconds,
  speechSupported,
  onToggleListen,
  onSubmit,
  isLastQuestion,
  grading,
}: {
  item: ImageInterpretItem
  text: string
  onTextChange: (v: string) => void
  isListening: boolean
  voiceSecondsLeft: number
  voiceMaxSeconds: number
  speechSupported: boolean
  onToggleListen: () => void
  onSubmit: () => void
  isLastQuestion: boolean
  grading: boolean
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-2 border-cyan-500/30">
        <CardContent className="space-y-4 pt-1">
          {/* Banner */}
          <div className="flex items-center gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-background">
              <Eye className="size-5 text-cyan-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-cyan-600">Image Interpretation</p>
              <p className="text-sm font-bold text-foreground">Describe what you see</p>
              <p className="text-[11px] italic text-muted-foreground">Direct observation before differential — Osler&apos;s first principle.</p>
            </div>
          </div>

          {/* Patient context */}
          {(item.patientVoice || item.clinicalNote) && (
            <ScenarioBlock
              patientVoice={item.patientVoice}
              clinicalNote={item.clinicalNote}
            />
          )}

          {/* The image */}
          <div className="overflow-hidden rounded-xl border border-border bg-slate-900">
            {!imgFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.imageAlt}
                onError={() => setImgFailed(true)}
                className="block w-full max-h-96 object-contain bg-black"
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-center text-xs text-muted-foreground p-6">
                <div>
                  <Eye className="mx-auto mb-2 size-10 text-muted-foreground/40" />
                  <p>Image unavailable. Imagine the clinical photograph from the caption below and describe what you would see.</p>
                </div>
              </div>
            )}
            <p className="px-3 py-1.5 text-[10px] text-slate-300">
              {item.imageCaption} <span className="text-slate-500">· {item.imageSource}</span>
            </p>
          </div>

          {/* Prompt */}
          <div>
            <p className="text-sm font-semibold text-foreground">{item.prompt}</p>
          </div>

          {/* Answer area */}
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Describe what you see, then your reasoning and plan..."
              rows={6}
              className="resize-none rounded-xl"
              disabled={grading}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">{wordCount} words</span>
              <div className="flex gap-2">
                {speechSupported && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isListening ? 'default' : 'outline'}
                    onClick={onToggleListen}
                    disabled={grading}
                    className={cn('gap-1.5', isListening && 'bg-red-500 text-white hover:bg-red-600')}
                  >
                    {isListening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                    {isListening ? `Stop (${voiceSecondsLeft}s)` : `Speak (max ${voiceMaxSeconds}s)`}
                  </Button>
                )}
                <Button onClick={onSubmit} disabled={!text.trim() || grading} className="gap-1.5">
                  {grading ? (
                    <>
                      <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Grading...
                    </>
                  ) : isLastQuestion ? (
                    <>Submit &amp; See Report <ArrowRight className="size-3.5" /></>
                  ) : (
                    <>Submit &amp; Continue <ArrowRight className="size-3.5" /></>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// REVIEW REPORT — final page after MAX_QUESTIONS
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// COACH REPORT TYPES — what /api/report-coach returns
// ---------------------------------------------------------------------------
interface CoachStrength {
  area: string
  observation: string
}
interface CoachGrowthArea {
  title: string
  openingPunchLine: string
  acknowledgment: string
  teaching: string
  futureFraming: string
  nextAction: string
}
interface CoachReport {
  greetingPunchLine: string
  masteryHeadline: string
  strengths: CoachStrength[]
  growthAreas: CoachGrowthArea[]
  closingNote?: string
  /** Provider-neutral: 'ai' = upstream coach; 'fallback' = local deterministic report. */
  source?: 'ai' | 'fallback'
}

function ReviewReport({
  topicId,
  topicLabel,
  answers,
}: {
  topicId: string
  topicLabel: string
  answers: AnswerRecord[]
  sessionState: SessionState
}) {
  const { currentUser } = useRole()
  const [coach, setCoach] = useState<CoachReport | null>(null)
  const [coachLoading, setCoachLoading] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Mastery percentage = % of items that scored as solid
  const masteryPercent = answers.length === 0 ? 0 : Math.round((answers.filter((a) => a.isCorrect).length / answers.length) * 100)

  // Aggregate axis averages (for the OPTIONAL collapsed advanced view only)
  const axisAverages: Record<Axis, { total: number; count: number; avg: number }> = {
    knowledge: { total: 0, count: 0, avg: 0 },
    reasoning: { total: 0, count: 0, avg: 0 },
    communication: { total: 0, count: 0, avg: 0 },
    empathy: { total: 0, count: 0, avg: 0 },
    relevance: { total: 0, count: 0, avg: 0 },
    safety: { total: 0, count: 0, avg: 0 },
  }
  answers.forEach((a) => {
    Object.entries(a.axisScores).forEach(([axis, score]) => {
      if (score === undefined || score === null) return
      axisAverages[axis as Axis].total += score
      axisAverages[axis as Axis].count++
    })
  })
  ;(Object.keys(axisAverages) as Axis[]).forEach((axis) => {
    const r = axisAverages[axis]
    r.avg = r.count > 0 ? Math.round(r.total / r.count) : 0
  })

  // Aggregate missed history items for the "questions you didn't ask" callout
  const missedHistoryAggregate: Record<string, NonNullable<AnswerRecord['missedHistory']>[number]> = {}
  answers.forEach((a) => {
    a.missedHistory?.forEach((m) => {
      if (!missedHistoryAggregate[m.id]) missedHistoryAggregate[m.id] = m
    })
  })
  const missedHistoryList = Object.values(missedHistoryAggregate).sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.criticality] - order[b.criticality]
  })

  // Fetch the warm narrative coach report on mount
  useEffect(() => {
    let cancelled = false
    async function loadCoach() {
      try {
        const residentName = currentUser.name.replace(/^Dr\.\s+/, '').split(' ')[0]
        const res = await fetch('/api/report-coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topicLabel,
            residentName,
            items: answers.map((a) => ({
              itemId: a.itemId,
              subTopic: a.subTopic,
              prompt: a.prompt ?? '',
              audience: a.audience,
              learnerAnswer: a.learnerAnswer ?? '',
              modelAnswer: a.modelAnswer,
              axisScores: a.axisScores,
              isCorrect: a.isCorrect,
            })),
          }),
        })
        if (!res.ok) throw new Error('coach failed')
        const data = (await res.json()) as CoachReport
        if (!cancelled) {
          setCoach(data)
          setCoachLoading(false)
        }
      } catch {
        if (!cancelled) {
          // Inline minimal fallback (the API also has a fallback, but if even
          // the request fails we still want to render something useful)
          setCoach({
            greetingPunchLine: `Doctor, you finished the ${topicLabel} session — here is the read.`,
            masteryHeadline:
              masteryPercent >= 70
                ? 'Strong overall, with a few specific areas to push.'
                : masteryPercent >= 40
                  ? 'Building well — close the gaps before the next test.'
                  : 'There is real ground to cover. Spend a few sessions in Learn mode before retesting.',
            strengths: [],
            growthAreas: [],
            closingNote: 'Come back when you have spent a little time in Learn — the next test will feel different.',
            source: 'fallback',
          })
          setCoachLoading(false)
        }
      }
    }
    loadCoach()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-6">
      {/* Back link */}
      <Link
        href={`/topics/${topicId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to topic
      </Link>

      {/* Loading state — coach report is being generated */}
      {coachLoading && (
        <Card>
          <CardContent className="flex items-center gap-3 py-12 text-center">
            <div className="mx-auto flex flex-col items-center gap-3">
              <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Reviewing your answers...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The warm narrative coach report */}
      {coach && !coachLoading && (
        <>
          {/* Greeting punch line */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="rounded-2xl border border-primary/20 bg-linear-to-br from-primary/8 via-background to-background p-6"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Your debrief on {topicLabel}
            </p>
            <p className="mt-2 text-lg font-semibold leading-snug text-foreground sm:text-xl">
              {coach.greetingPunchLine}
            </p>
            <p className="mt-2 text-sm italic text-muted-foreground">{coach.masteryHeadline}</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-linear-to-r from-emerald-400 to-primary transition-all"
                  style={{ width: `${masteryPercent}%` }}
                />
              </div>
              <span className="text-sm font-bold tabular-nums text-foreground">{masteryPercent}%</span>
              <span className="text-[11px] text-muted-foreground">on track</span>
            </div>
          </motion.div>

          {/* Strengths first — protect morale */}
          {coach.strengths.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="border-emerald-200 dark:border-emerald-500/30">
                <CardContent className="space-y-3 pt-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <h2 className="text-base font-bold text-foreground">What you showed me you can do</h2>
                  </div>
                  <ul className="space-y-3">
                    {coach.strengths.map((s, i) => (
                      <li key={i} className="space-y-0.5">
                        <p className="text-sm font-semibold text-foreground">{s.area}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{s.observation}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Growth areas — the teaching arcs */}
          {coach.growthAreas.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-rose-600" />
                <h2 className="text-base font-bold text-foreground">Where we go next</h2>
              </div>
              {coach.growthAreas.map((g, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.05 }}
                >
                  <Card className="overflow-hidden border-rose-200 dark:border-rose-500/30">
                    {/* Title bar */}
                    <div className="border-b border-rose-200 bg-rose-50/40 px-5 py-3 dark:border-rose-500/20 dark:bg-rose-950/20">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                          {i + 1}
                        </span>
                        <h3 className="text-sm font-bold leading-snug text-foreground">{g.title}</h3>
                      </div>
                    </div>

                    {/* Teaching arc body */}
                    <CardContent className="space-y-3 pt-4 text-sm leading-relaxed text-foreground">
                      <p className="font-semibold text-rose-700 dark:text-rose-300">{g.openingPunchLine}</p>
                      <p className="text-muted-foreground">{g.acknowledgment}</p>
                      <p className="whitespace-pre-line text-foreground/90">{g.teaching}</p>
                      <p className="border-l-2 border-rose-300 pl-3 italic text-foreground/85 dark:border-rose-500/40">
                        {g.futureFraming}
                      </p>
                      <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        <span className="mr-1 font-semibold text-foreground">→</span>
                        {g.nextAction}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          {/* Missed history items — keep this as a useful raw signal */}
          {missedHistoryList.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-500/20 dark:bg-amber-950/10">
              <CardContent className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <ListChecks className="size-4 text-amber-600" />
                  <h2 className="text-base font-bold text-foreground">Questions you didn&apos;t ask the patient</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Some of the most consequential clinical errors are the questions a doctor never thought to ask. Worth glancing through.
                </p>
                <div className="space-y-2">
                  {missedHistoryList.slice(0, 5).map((m) => (
                    <div key={m.id} className="rounded-lg border border-amber-200 bg-card p-3 dark:border-amber-500/20">
                      <p className="text-sm font-semibold text-foreground">{m.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{m.whyMatters}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Closing note */}
          {coach.closingNote && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-center text-sm italic text-muted-foreground"
            >
              {coach.closingNote}
            </motion.p>
          )}

          {/* Optional: advanced view — collapsed by default */}
          <details className="group rounded-xl border border-border/60 bg-card">
            <summary
              className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.preventDefault()
                setShowAdvanced((s) => !s)
              }}
            >
              <span>Advanced view — detailed numerical breakdown</span>
              <ArrowRight className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-90')} />
            </summary>
            {showAdvanced && (
              <div className="space-y-4 border-t border-border/60 p-4">
                {(Object.keys(axisAverages) as Axis[]).map((axis) => {
                  const r = axisAverages[axis]
                  if (r.count === 0) return null
                  const cfg = AXIS_CONFIG[axis]
                  const Icon = cfg.icon
                  return (
                    <div key={axis} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('size-4', cfg.color)} />
                        <span className="flex-1 text-sm font-medium text-foreground">{cfg.label}</span>
                        <span className="w-10 text-right text-sm font-bold tabular-nums text-foreground">{r.avg}</span>
                      </div>
                      <AnimatedBar value={r.avg} barClassName={cn(cfg.color.replace('text-', 'bg-'))} className="h-1.5" />
                    </div>
                  )
                })}
              </div>
            )}
          </details>

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <Link href={`/topics/${topicId}`} className="flex-1">
              <Button variant="outline" className="w-full">Back to topic</Button>
            </Link>
            <Link href="/topics" className="flex-1">
              <Button variant="outline" className="w-full">All topics</Button>
            </Link>
          </div>
        </>
      )}
    </PageTransition>
  )
}

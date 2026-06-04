/**
 * VAIDIX ADAPTIVE REVIEW ENGINE — Phase A (Rule-Based)
 *
 * This file is the SWAP POINT for the future ML / Claude API upgrade.
 *
 * Phase A (now):
 *   - Rule-based item selection from a fixed item bank
 *   - θ adjusted ±0.08 per answer
 *   - Axis targeting picks weakest axis for next probe
 *   - Standard error proxy decides termination (min 6, max 20 questions)
 *
 * Phase B (planned):
 *   - gradeAnswer() will call Claude API to score free-text answers
 *   - adaptiveEngine() will optionally call Claude to generate branching probes
 *     when high-criticality history items are missed
 *
 * Phase C (planned):
 *   - Trained model replaces adaptiveEngine() entirely
 *   - Item bank calibrated via real IRT once we have 200+ responses per item
 *
 * The function signatures of adaptiveEngine() and gradeAnswer() are stable —
 * everything else can be swapped under the hood without touching the UI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type Axis =
  | 'knowledge'
  | 'reasoning'
  | 'communication'
  | 'empathy'
  | 'relevance'
  | 'safety'

/**
 * Minimal item interface — the engine only cares about these fields.
 * Real items in review-items.json have more (rubrics, scenarios, etc.)
 * but the engine treats those as opaque.
 */
export interface AdaptiveItem {
  id: string
  topic: string
  subTopic: string
  difficulty: number // 0.0 - 1.0 — overall item difficulty
  type: 'explain-to' | 'noise-filter' | 'history-audit' | 'image-interpret'
  axesScored: Axis[]
  /** Optional audience hint — informs per-axis difficulty derivation */
  audience?: 'patient_family' | 'peer' | 'senior'
  /** Per-axis difficulty if explicitly specified; otherwise derived */
  axisDifficulty?: Partial<Record<Axis, number>>
}

/**
 * Derive a per-axis difficulty score for an item.
 * Phase A: rule-based from audience + base difficulty + axes scored.
 * Phase B: faculty-curated and stored on each item.
 *
 * Logic:
 *  - If item declares axisDifficulty[axis], use it
 *  - Otherwise, audience-aware modifier:
 *      patient_family items make Communication and Empathy harder
 *      peer items make Knowledge and Reasoning harder
 *      senior items make Relevance and Safety harder
 *  - History-audit items make Safety and Relevance harder
 *  - Noise-filter items make Relevance harder
 *  - Image-interpret items make Knowledge harder
 */
export function deriveAxisDifficulty(item: AdaptiveItem, axis: Axis): number {
  if (item.axisDifficulty?.[axis] !== undefined) {
    return item.axisDifficulty[axis]!
  }
  let d = item.difficulty
  // Audience modifiers
  if (item.audience === 'patient_family' && (axis === 'communication' || axis === 'empathy')) {
    d = Math.min(0.95, d + 0.1)
  }
  if (item.audience === 'peer' && (axis === 'knowledge' || axis === 'reasoning')) {
    d = Math.min(0.95, d + 0.1)
  }
  if (item.audience === 'senior' && (axis === 'relevance' || axis === 'safety')) {
    d = Math.min(0.95, d + 0.15)
  }
  // Type modifiers
  if (item.type === 'history-audit' && (axis === 'safety' || axis === 'relevance')) {
    d = Math.min(0.95, d + 0.05)
  }
  if (item.type === 'noise-filter' && axis === 'relevance') {
    d = Math.min(0.95, d + 0.05)
  }
  return d
}

export interface GradedResult {
  axisScores: Partial<Record<Axis, number>>
  isCorrect: boolean
  missedHistory?: {
    id: string
    label: string
    criticality: 'high' | 'medium' | 'low'
    whyMatters: string
  }[]
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────────────────────────────────────

export interface AxisProfile {
  scores: number[] // every score this axis has received
  count: number
  avg: number
}

export interface BranchingProbe {
  triggeringItemId: string
  triggeringSubTopic: string
  missedItemId: string
  missedItemLabel: string
}

export interface SessionState {
  theta: number // 0.1 - 1.0 ability estimate
  axisProfile: Record<Axis, AxisProfile>
  subTopicCoverage: Record<string, number>
  recentResults: boolean[] // sliding window of last 5 (correct?)
  /** Sliding window of the last 3 item types — used to enforce variety in
   *  the next-item picker so we don't show three explain-to items in a row. */
  recentTypes: AdaptiveItem['type'][]
  questionsAnswered: number
  used: Set<string>
  pendingBranching: BranchingProbe[]
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const MIN_QUESTIONS = 6
const MAX_QUESTIONS = 20
/** Lower = stricter; we terminate when SE drops below this */
const TERMINATION_SE = 0.18
/** Each axis must be tested at least this many times before we can terminate */
const MIN_AXIS_COVERAGE = 1
/** Recent window size for trend calculation */
const TREND_WINDOW = 5

const ALL_AXES: Axis[] = [
  'knowledge',
  'reasoning',
  'communication',
  'empathy',
  'relevance',
  'safety',
]

// ─────────────────────────────────────────────────────────────────────────────
// STATE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

export function createInitialState(): SessionState {
  const profile = {} as Record<Axis, AxisProfile>
  ALL_AXES.forEach((a) => {
    profile[a] = { scores: [], count: 0, avg: 0 }
  })
  return {
    theta: 0.5,
    axisProfile: profile,
    subTopicCoverage: {},
    recentResults: [],
    recentTypes: [],
    questionsAnswered: 0,
    used: new Set(),
    pendingBranching: [],
  }
}

/**
 * Update state after a graded answer. Pure function — returns new state.
 */
export function updateState(
  state: SessionState,
  item: AdaptiveItem,
  result: GradedResult
): SessionState {
  // Update axis profile
  const newAxisProfile: Record<Axis, AxisProfile> = { ...state.axisProfile }
  for (const [axis, score] of Object.entries(result.axisScores)) {
    if (score === undefined || score === null) continue
    const a = axis as Axis
    const profile = newAxisProfile[a]
    const newScores = [...profile.scores, score]
    const newCount = profile.count + 1
    const newAvg = newScores.reduce((s, v) => s + v, 0) / newCount
    newAxisProfile[a] = { scores: newScores, count: newCount, avg: newAvg }
  }

  // Update theta — bigger jumps when confidence is low (early items)
  const baseAdjustment = result.isCorrect ? 0.08 : -0.08
  const earlyMultiplier = state.questionsAnswered < 3 ? 1.5 : 1.0
  const newTheta = Math.max(
    0.1,
    Math.min(1, state.theta + baseAdjustment * earlyMultiplier)
  )

  // Sub-topic coverage
  const newSubTopicCoverage = { ...state.subTopicCoverage }
  newSubTopicCoverage[item.subTopic] =
    (newSubTopicCoverage[item.subTopic] ?? 0) + 1

  // Recent results sliding window
  const newRecentResults = [...state.recentResults, result.isCorrect].slice(
    -TREND_WINDOW
  )

  // Used set
  const newUsed = new Set(state.used)
  newUsed.add(item.id)

  // Branching: when a high-criticality history item is missed, queue a probe
  // (Phase A: just records the trigger; Phase B will use Claude to generate a follow-up scenario)
  let newPending = state.pendingBranching
  if (item.type === 'history-audit' && result.missedHistory) {
    const highMissed = result.missedHistory.filter(
      (m) => m.criticality === 'high'
    )
    if (highMissed.length > 0) {
      newPending = [
        ...newPending,
        {
          triggeringItemId: item.id,
          triggeringSubTopic: item.subTopic,
          missedItemId: highMissed[0].id,
          missedItemLabel: highMissed[0].label,
        },
      ]
    }
  }

  // Recent types sliding window (last 3) — used by the picker to enforce
  // variety so the learner doesn't get three explain-to items in a row.
  const newRecentTypes = [...state.recentTypes, item.type].slice(-3)

  return {
    theta: newTheta,
    axisProfile: newAxisProfile,
    subTopicCoverage: newSubTopicCoverage,
    recentResults: newRecentResults,
    recentTypes: newRecentTypes,
    questionsAnswered: state.questionsAnswered + 1,
    used: newUsed,
    pendingBranching: newPending,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard error proxy. In real IRT this is computed from Fisher information.
 * Phase A approximation: 1 / sqrt(n+1), shrinks as more questions are answered.
 */
function standardError(state: SessionState): number {
  if (state.questionsAnswered === 0) return 1.0
  return 1 / Math.sqrt(state.questionsAnswered + 1)
}

/**
 * Find the axis most in need of testing.
 * Priority: untested axes > axes with lowest avg.
 */
function findWeakestAxis(state: SessionState): Axis | undefined {
  const entries = Object.entries(state.axisProfile) as [Axis, AxisProfile][]
  // Untested axes first
  const untested = entries.find(([, p]) => p.count < MIN_AXIS_COVERAGE)
  if (untested) return untested[0]
  // Otherwise, lowest average
  entries.sort((a, b) => a[1].avg - b[1].avg)
  return entries[0]?.[0]
}

/**
 * Should the test terminate?
 *
 * Early termination scenarios:
 *   1. MAX_QUESTIONS reached (safety cap)
 *   2. After MIN_QUESTIONS, every axis tested AND standard error < threshold
 *   3. After MIN_QUESTIONS, sustained low ability (theta low + recent answers
 *      mostly wrong) — keep going at this level is unkind, end with the
 *      "revisit Learn first" report
 *   4. After MIN_QUESTIONS, sustained ceiling (theta high + recent answers
 *      mostly correct) — we have evidence of mastery, no need to drag on
 */
function shouldTerminate(state: SessionState): {
  should: boolean
  reason: string
} {
  if (state.questionsAnswered >= MAX_QUESTIONS) {
    return { should: true, reason: 'Maximum question limit reached' }
  }
  if (state.questionsAnswered < MIN_QUESTIONS) {
    return { should: false, reason: '' }
  }

  const recentRight = state.recentResults.filter((r) => r).length
  const recentTotal = state.recentResults.length

  // Sustained low ability — kindness termination
  if (
    state.theta < 0.3 &&
    recentTotal >= 3 &&
    recentRight / recentTotal <= 0.34
  ) {
    return {
      should: true,
      reason: 'Sustained low ability — recommending Learn mode before retesting',
    }
  }

  // Sustained ceiling — mastery termination
  if (
    state.theta > 0.8 &&
    recentTotal >= 3 &&
    recentRight / recentTotal >= 0.85
  ) {
    return {
      should: true,
      reason: 'Sustained mastery confirmed — no further questions needed',
    }
  }

  // Every axis tested at least once
  const allAxesCovered = Object.values(state.axisProfile).every(
    (p) => p.count >= MIN_AXIS_COVERAGE
  )
  if (!allAxesCovered) {
    return { should: false, reason: '' }
  }

  // Standard error below threshold = enough confidence
  const se = standardError(state)
  if (se < TERMINATION_SE) {
    return {
      should: true,
      reason: `Sufficient confidence in ability estimate (SE=${se.toFixed(2)})`,
    }
  }
  return { should: false, reason: '' }
}

/**
 * Score an item for selection priority.
 *
 * If we have a target axis, we use its derived axis-specific difficulty
 * (so when Communication is the weak axis, the engine looks for items
 * where Communication is harder than the current overall difficulty).
 *
 * Weights: 55% difficulty match, 25% axis targeting, 10% sub-topic novelty,
 * 10% seeded jitter (so different sessions diverge on near-tie candidates).
 */
function scoreItemFitness(
  item: AdaptiveItem,
  state: SessionState,
  targetDifficulty: number,
  targetAxis: Axis | undefined,
  jitterRng: () => number
): number {
  // 1. Difficulty closeness — use axis-specific difficulty if we are
  //    targeting an axis the item scores
  const itemDifficulty =
    targetAxis && item.axesScored.includes(targetAxis)
      ? deriveAxisDifficulty(item, targetAxis)
      : item.difficulty
  const difficultyScore = 1 - Math.abs(itemDifficulty - targetDifficulty)

  // 2. Axis targeting bonus
  const axisScore = targetAxis && item.axesScored.includes(targetAxis) ? 1 : 0

  // 3. Sub-topic novelty bonus
  const subTopicCount = state.subTopicCoverage[item.subTopic] ?? 0
  const subTopicScore = subTopicCount === 0 ? 1 : 1 / (subTopicCount + 1)

  // 4. Type variety bonus — strongly penalize repeating the same item type
  //    3 times in a row, mildly penalize 2 in a row. Keeps the review from
  //    feeling like an endless stream of explain-to cases.
  const recent = state.recentTypes
  const lastType = recent[recent.length - 1]
  const secondLastType = recent[recent.length - 2]
  let varietyScore = 1
  if (lastType === item.type && secondLastType === item.type) {
    varietyScore = 0.1 // near-veto after 2 same in a row
  } else if (lastType === item.type) {
    varietyScore = 0.55
  }

  // 5. Seeded jitter — small random nudge so different sessions explore
  //    different paths through the item bank
  const jitter = jitterRng()

  return (
    difficultyScore * 0.45 +
    axisScore * 0.2 +
    subTopicScore * 0.1 +
    varietyScore * 0.15 +
    jitter * 0.1
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ENGINE — public API
// ─────────────────────────────────────────────────────────────────────────────

export interface NextAction {
  action: 'continue' | 'finish'
  item?: AdaptiveItem
  reason: string
  metadata: {
    theta: number
    targetDifficulty: number
    weakestAxis?: Axis
    confidence: 'building' | 'stable' | 'high'
    standardError: number
    minQuestions: number
    maxQuestions: number
    progressEstimate: number // 0-1
  }
}

import { mulberry32 } from './seeded-random'

/**
 * THE ADAPTIVE ENGINE
 *
 * Given current session state and a pool of available items, decide the
 * next action: pick the next item or terminate the test.
 *
 * Phase A: rule-based scoring as documented at the top of this file.
 * Phase B: this entire function body can be replaced with a Claude API call
 *           that takes the same inputs and returns the same shape.
 *
 * @param seed - per-session seed so 10 team members get genuinely different
 *               question orders (jitter on near-tie items + reproducible
 *               shuffles). Defaults to a fixed value if not provided.
 */
export function adaptiveEngine<T extends AdaptiveItem>(
  state: SessionState,
  pool: T[],
  seed: number = 42
): NextAction & { item?: T } {
  // Mix the seed with questionsAnswered so the jitter changes per question
  // but is still reproducible if we replay the session.
  const jitterRng = mulberry32(seed + state.questionsAnswered * 9973)

  // 1. TERMINATION CHECK
  const term = shouldTerminate(state)
  if (term.should) {
    return {
      action: 'finish',
      reason: term.reason,
      metadata: {
        theta: state.theta,
        targetDifficulty: state.theta,
        confidence: 'high',
        standardError: standardError(state),
        minQuestions: MIN_QUESTIONS,
        maxQuestions: MAX_QUESTIONS,
        progressEstimate: 1,
      },
    }
  }

  // 2. AXIS TARGETING
  const weak = findWeakestAxis(state)

  // 3. DIFFICULTY TARGETING — recent trend nudges target ±0.1
  const recent = state.recentResults
  const recentRight = recent.filter((r) => r).length
  const trendBoost =
    recent.length >= 3 ? (recentRight / recent.length - 0.5) * 0.2 : 0
  let targetDifficulty = state.theta + trendBoost
  targetDifficulty = Math.max(0.1, Math.min(0.95, targetDifficulty))

  // 4. ITEM SELECTION
  const candidates = pool.filter((i) => !state.used.has(i.id))
  if (candidates.length === 0) {
    return {
      action: 'finish',
      reason: 'No more items in the topic pool',
      metadata: {
        theta: state.theta,
        targetDifficulty,
        weakestAxis: weak,
        confidence: 'stable',
        standardError: standardError(state),
        minQuestions: MIN_QUESTIONS,
        maxQuestions: MAX_QUESTIONS,
        progressEstimate: 1,
      },
    }
  }

  const scored = candidates
    .map((item) => ({
      item,
      score: scoreItemFitness(item, state, targetDifficulty, weak, jitterRng),
    }))
    .sort((a, b) => b.score - a.score)

  const chosen = scored[0].item

  // 5. BUILD HUMAN-READABLE REASON
  const reasonParts: string[] = []
  if (weak && chosen.axesScored.includes(weak)) {
    const avg = Math.round(state.axisProfile[weak].avg)
    if (state.axisProfile[weak].count === 0) {
      reasonParts.push(`Probing untested axis: ${weak}`)
    } else {
      reasonParts.push(`Targeting weakest axis: ${weak} (avg ${avg})`)
    }
  }
  reasonParts.push(
    `Difficulty ${Math.round(chosen.difficulty * 100)}% near θ ${Math.round(state.theta * 100)}%`
  )
  if ((state.subTopicCoverage[chosen.subTopic] ?? 0) === 0) {
    reasonParts.push(`New sub-topic: ${chosen.subTopic}`)
  }

  // 6. CONFIDENCE LABEL
  const se = standardError(state)
  let confidence: 'building' | 'stable' | 'high' = 'building'
  if (se < 0.3) confidence = 'stable'
  if (se < TERMINATION_SE + 0.05) confidence = 'high'

  // 7. PROGRESS ESTIMATE — how close we are to terminating
  // (simple: questionsAnswered / expected_total, where expected_total = ~12)
  const progressEstimate = Math.min(0.95, state.questionsAnswered / 12)

  return {
    action: 'continue',
    item: chosen,
    reason: reasonParts.join(' · '),
    metadata: {
      theta: state.theta,
      targetDifficulty,
      weakestAxis: weak,
      confidence,
      standardError: se,
      minQuestions: MIN_QUESTIONS,
      maxQuestions: MAX_QUESTIONS,
      progressEstimate,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL REPORT AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────

export interface AnsweredItem {
  itemId: string
  subTopic: string
  difficulty: number
  axisScores: Partial<Record<Axis, number>>
  isCorrect: boolean
  missedHistory?: GradedResult['missedHistory']
}

export interface FinalReport {
  questionsAnswered: number
  finalTheta: number
  finalSE: number
  axisAverages: Record<Axis, { avg: number; count: number }>
  greyAreas: { axis: Axis; avg: number }[]
  strengths: { axis: Axis; avg: number }[]
  subTopicHeatmap: Record<string, { correct: number; total: number }>
  missedHighHistory: NonNullable<GradedResult['missedHistory']>
  missedMediumHistory: NonNullable<GradedResult['missedHistory']>
  missedLowHistory: NonNullable<GradedResult['missedHistory']>
}

const GREY_AREA_THRESHOLD = 65
const STRENGTH_THRESHOLD = 75

export function buildFinalReport(
  state: SessionState,
  answers: AnsweredItem[]
): FinalReport {
  const axisAverages = {} as Record<Axis, { avg: number; count: number }>
  ALL_AXES.forEach((a) => {
    axisAverages[a] = {
      avg: state.axisProfile[a].avg,
      count: state.axisProfile[a].count,
    }
  })

  const greyAreas = ALL_AXES.filter(
    (a) => axisAverages[a].count > 0 && axisAverages[a].avg < GREY_AREA_THRESHOLD
  )
    .map((a) => ({ axis: a, avg: Math.round(axisAverages[a].avg) }))
    .sort((a, b) => a.avg - b.avg)

  const strengths = ALL_AXES.filter(
    (a) => axisAverages[a].count > 0 && axisAverages[a].avg >= STRENGTH_THRESHOLD
  )
    .map((a) => ({ axis: a, avg: Math.round(axisAverages[a].avg) }))
    .sort((a, b) => b.avg - a.avg)

  const subTopicHeatmap: Record<string, { correct: number; total: number }> = {}
  answers.forEach((a) => {
    if (!subTopicHeatmap[a.subTopic])
      subTopicHeatmap[a.subTopic] = { correct: 0, total: 0 }
    subTopicHeatmap[a.subTopic].total++
    if (a.isCorrect) subTopicHeatmap[a.subTopic].correct++
  })

  // Aggregate missed history (deduped, sorted by criticality)
  type MissedItem = NonNullable<GradedResult['missedHistory']>[number]
  const missedMap: Record<string, MissedItem> = {}
  answers.forEach((a) => {
    a.missedHistory?.forEach((m) => {
      if (!missedMap[m.id]) missedMap[m.id] = m
    })
  })
  const allMissed = Object.values(missedMap)
  const missedHighHistory = allMissed.filter((m) => m.criticality === 'high')
  const missedMediumHistory = allMissed.filter((m) => m.criticality === 'medium')
  const missedLowHistory = allMissed.filter((m) => m.criticality === 'low')

  return {
    questionsAnswered: state.questionsAnswered,
    finalTheta: state.theta,
    finalSE: standardError(state),
    axisAverages,
    greyAreas,
    strengths,
    subTopicHeatmap,
    missedHighHistory,
    missedMediumHistory,
    missedLowHistory,
  }
}

/**
 * VAIDIX TRAINING QUEUE
 *
 * Captures answers that the rule-based engine could not confidently score.
 * These become training data for the Phase B ML model.
 *
 * Storage: localStorage (Phase A) → PostgreSQL + faculty review queue (Phase B).
 *
 * The capture decision is intentionally permissive. If the heuristic scorer
 * has any reason to be uncertain (low keyword match, mixed signals, unusual
 * length, outlier difficulty-vs-score), we capture the answer.
 *
 * Faculty review the queue at /admin/training-queue and provide ground truth.
 * Their corrections become the labelled dataset for fine-tuning Claude or
 * training a custom model.
 */

import type { Axis } from './adaptive-engine'

const STORAGE_KEY = 'vaidix.training-queue.v1'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type NoveltyFlag =
  | 'low_keyword_match' // neither good nor poor patterns triggered
  | 'mixed_signals' // both good and poor patterns appeared
  | 'unusual_length' // far longer or shorter than expected
  | 'outlier_difficulty' // hard item scored high or easy item scored low
  | 'paraphrase_suspected' // history-audit: low coverage but long answer
  | 'manual_flag' // faculty explicitly flagged

export type ItemType = 'explain-to' | 'history-audit' | 'noise-filter' | 'image-interpret'

export interface EngineScore {
  axisScores: Partial<Record<Axis, number>>
  isCorrect: boolean
  /** 0-1, how confident the heuristic was */
  confidence: number
}

export interface FacultyReview {
  reviewedBy: string
  reviewedAt: string
  facultyAxisScores: Partial<Record<Axis, number>> | null
  facultyVerdict: 'agree' | 'disagree' | 'partial'
  facultyNotes: string
  addToRubric?: {
    goodKeywords?: string[]
    poorKeywords?: string[]
    newRequiredHistoryItem?: {
      label: string
      criticality: 'high' | 'medium' | 'low'
      keywords: string[]
      whyMatters: string
    }
  }
}

export interface TrainingQueueEntry {
  id: string
  capturedAt: string
  itemId: string
  itemTopic: string
  itemSubTopic: string
  itemType: ItemType
  itemDifficulty: number
  audience?: 'patient_family' | 'peer' | 'senior'
  rawAnswer: unknown
  engineScore: EngineScore
  noveltyFlags: NoveltyFlag[]
  sessionContext: {
    role: string
    questionsAnsweredBefore: number
    thetaAtCapture: number
  }
  facultyReview: FacultyReview | null
}

// ─────────────────────────────────────────────────────────────────────────────
// NOVELTY DETECTION — when should we capture an answer?
// ─────────────────────────────────────────────────────────────────────────────

interface ExplainNoveltyInput {
  type: 'explain-to'
  answer: string
  goodHits: number
  poorHits: number
  goodTotal: number
  poorTotal: number
  audience: 'patient_family' | 'peer' | 'senior'
  expectedWordsMin: number
  expectedWordsMax: number
  difficulty: number
  finalScore: number
}

interface HistoryNoveltyInput {
  type: 'history-audit'
  answer: string
  coveredCount: number
  totalRequired: number
  difficulty: number
  finalScore: number
}

interface NoiseNoveltyInput {
  type: 'noise-filter'
  accuracy: number
  difficulty: number
  finalScore: number
}

/**
 * Decide whether an answer is "novel" enough to capture for training.
 * Returns the array of novelty flags (empty array = high confidence, no capture).
 */
export function detectNovelty(
  input: ExplainNoveltyInput | HistoryNoveltyInput | NoiseNoveltyInput
): { flags: NoveltyFlag[]; confidence: number } {
  const flags: NoveltyFlag[] = []

  if (input.type === 'explain-to') {
    const wordCount = input.answer.trim().split(/\s+/).filter(Boolean).length
    const totalRubric = input.goodTotal + input.poorTotal
    const totalHits = input.goodHits + input.poorHits
    const matchRate = totalRubric === 0 ? 0 : totalHits / totalRubric

    // Flag 1: low keyword match — neither rubric pattern triggered
    if (matchRate < 0.2 && wordCount > 15) {
      flags.push('low_keyword_match')
    }

    // Flag 2: mixed signals — both good AND poor keywords present
    if (input.goodHits > 0 && input.poorHits > 0 && input.goodHits === input.poorHits) {
      flags.push('mixed_signals')
    }

    // Flag 3: unusual length
    if (wordCount < input.expectedWordsMin || wordCount > input.expectedWordsMax * 2) {
      flags.push('unusual_length')
    }

    // Flag 4: outlier — hard item scored very high or easy item scored very low
    if (input.difficulty >= 0.75 && input.finalScore >= 90) {
      flags.push('outlier_difficulty')
    }
    if (input.difficulty <= 0.4 && input.finalScore <= 40) {
      flags.push('outlier_difficulty')
    }
  }

  if (input.type === 'history-audit') {
    const wordCount = input.answer.trim().split(/\s+/).filter(Boolean).length
    const coverageRate = input.coveredCount / input.totalRequired

    // Flag: long answer but low coverage = paraphrasing not caught by keywords
    if (wordCount > 60 && coverageRate < 0.4) {
      flags.push('paraphrase_suspected')
    }

    if (input.difficulty >= 0.75 && input.finalScore >= 90) {
      flags.push('outlier_difficulty')
    }
  }

  if (input.type === 'noise-filter') {
    if (input.difficulty >= 0.75 && input.finalScore >= 90) {
      flags.push('outlier_difficulty')
    }
    if (input.difficulty <= 0.4 && input.finalScore <= 40) {
      flags.push('outlier_difficulty')
    }
  }

  // Confidence inverse to flag count
  const confidence = Math.max(0.1, 1 - flags.length * 0.25)

  return { flags, confidence }
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE — write to localStorage
// ─────────────────────────────────────────────────────────────────────────────

export function captureAnswer(entry: Omit<TrainingQueueEntry, 'id' | 'capturedAt' | 'facultyReview'>): void {
  if (typeof window === 'undefined') return // SSR safety
  if (entry.noveltyFlags.length === 0) return // nothing to capture

  const queue = loadQueue()
  const fullEntry: TrainingQueueEntry = {
    ...entry,
    id: `tq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    capturedAt: new Date().toISOString(),
    facultyReview: null,
  }
  queue.push(fullEntry)
  // Cap at 500 entries to prevent localStorage overflow in demo
  const capped = queue.slice(-500)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
}

export function loadQueue(): TrainingQueueEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as TrainingQueueEntry[]
  } catch {
    return []
  }
}

export function saveQueue(queue: TrainingQueueEntry[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

export function updateEntry(id: string, review: FacultyReview): void {
  const queue = loadQueue()
  const next = queue.map((e) => (e.id === id ? { ...e, facultyReview: review } : e))
  saveQueue(next)
}

export function deleteEntry(id: string): void {
  const queue = loadQueue()
  saveQueue(queue.filter((e) => e.id !== id))
}

export function clearQueue(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Export the queue as JSONL for downstream ML training pipelines.
 * Each line is one entry; faculty-reviewed entries are the gold dataset.
 */
export function exportAsJSONL(): string {
  const queue = loadQueue()
  return queue.map((e) => JSON.stringify(e)).join('\n')
}

export function downloadJSONL(): void {
  if (typeof window === 'undefined') return
  const jsonl = exportAsJSONL()
  const blob = new Blob([jsonl], { type: 'application/x-jsonlines' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vaidix-training-queue-${Date.now()}.jsonl`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY for the queue page
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueSummary {
  total: number
  pendingReview: number
  reviewed: number
  byFlag: Record<NoveltyFlag, number>
  byTopic: Record<string, number>
  byItemType: Record<ItemType, number>
}

export function summarise(queue: TrainingQueueEntry[]): QueueSummary {
  const byFlag = {} as Record<NoveltyFlag, number>
  const byTopic = {} as Record<string, number>
  const byItemType = {} as Record<ItemType, number>

  queue.forEach((e) => {
    e.noveltyFlags.forEach((f) => {
      byFlag[f] = (byFlag[f] ?? 0) + 1
    })
    byTopic[e.itemTopic] = (byTopic[e.itemTopic] ?? 0) + 1
    byItemType[e.itemType] = (byItemType[e.itemType] ?? 0) + 1
  })

  return {
    total: queue.length,
    pendingReview: queue.filter((e) => !e.facultyReview).length,
    reviewed: queue.filter((e) => e.facultyReview).length,
    byFlag,
    byTopic,
    byItemType,
  }
}

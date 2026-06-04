/**
 * Client-side Gemini grader.
 * Calls /api/grade and falls back to a caller-provided heuristic on failure.
 *
 * This is the primary scorer for free-text Review answers.
 */

import type { Axis } from './adaptive-engine'

export interface GeminiGradeRequest {
  audience?: 'patient_family' | 'peer' | 'senior'
  scenario: string
  prompt: string
  axesScored: string[]
  rubric: { good: string[]; poor: string[] }
  modelAnswer?: string
  learnerAnswer: string
  isFollowUp?: boolean
  previousAnswer?: string
}

export interface GeminiGradeResponse {
  /** verdict drives the follow-up flow:
   *   vague    → ask clarification
   *   shallow  → ask escalation (only if engine allows)
   *   solid    → score and advance
   */
  verdict: 'vague' | 'shallow' | 'solid'
  followUpType: 'clarification' | 'escalation' | null
  followUpQuestion: string | null
  needsFollowUp: boolean
  axisScores: Partial<Record<Axis, number>>
  overallVerdict: 'strong' | 'borderline' | 'weak'
  shortFeedback: string
  /** Provider-neutral: 'ai' = upstream grader; 'heuristic' = local fallback. */
  source: 'ai' | 'heuristic'
}

/**
 * Attempt to grade with Gemini. On any failure, return null and let the
 * caller fall back to the heuristic scorer.
 */
export async function gradeWithGemini(
  req: GeminiGradeRequest
): Promise<GeminiGradeResponse | null> {
  try {
    const res = await fetch('/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })

    if (!res.ok) {
      return null
    }

    const data = await res.json()
    if (data.error) {
      return null
    }

    return {
      verdict: data.verdict ?? 'solid',
      followUpType: data.followUpType ?? null,
      followUpQuestion: data.followUpQuestion ?? null,
      needsFollowUp: Boolean(data.needsFollowUp),
      axisScores: data.axisScores ?? {},
      overallVerdict: data.overallVerdict ?? 'borderline',
      shortFeedback: data.shortFeedback ?? '',
      source: 'ai',
    }
  } catch (err) {
    console.warn('[gradeWithGemini] failed, falling back', err)
    return null
  }
}

/**
 * Send audio to /api/voice and get a transcript back.
 * Falls back gracefully to browser SpeechRecognition if the API is offline.
 */
export async function transcribeWithSarvam(audioBlob: Blob): Promise<string | null> {
  try {
    const fd = new FormData()
    fd.append('file', audioBlob, 'recording.webm')
    const res = await fetch('/api/voice', { method: 'POST', body: fd })
    if (!res.ok) return null
    const data = await res.json()
    return data.transcript ?? null
  } catch (err) {
    console.warn('[transcribeWithSarvam] failed', err)
    return null
  }
}

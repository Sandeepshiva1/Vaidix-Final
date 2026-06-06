// POST  /api/classroom/sessions/[id]/learners/quiz-response
// PATCH /api/classroom/sessions/[id]/learners/quiz-response
//
// Learner submits (or updates) their answer to a presenter-configured pre-session
// quiz question. One row per (session, user, question) — upserted on every call.
// Requires authentication; no CSRF needed (idempotent write, no state mutation
// beyond the learner's own answer row).

import { jsonError, jsonOk, requireAuth, handleUnexpected, requireCsrf } from '@/server/services/api-helpers'
import { db } from '@/lib/db'

interface QuizResponseBody {
  questionId: string
  answer: number       // option index for MCQ; -1 for open-ended
  answerText?: string  // required when answer === -1
}

async function handle(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const csrf = await requireCsrf(req)
  if (!csrf.ok) return csrf.response

  const { id: sessionId } = await ctx.params

  // Session must exist and not be deleted.
  const session = await db.teachingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: {
      id: true,
      metadata: true,
      status: true,
    },
  })
  if (!session) return jsonError('NOT_FOUND', 'Session not found', 404)

  // Validate that the question exists in the session's learnerPrep config.
  const meta = session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)
    ? (session.metadata as Record<string, unknown>)
    : {}
  const lp = meta.learnerPrep && typeof meta.learnerPrep === 'object'
    ? (meta.learnerPrep as Record<string, unknown>)
    : {}
  const mcqs = Array.isArray(lp.mcqs)
    ? (lp.mcqs as Array<{ id: string; q: string; options: string[]; correct: number }>)
    : []
  const openEnded = Array.isArray(lp.openEnded)
    ? (lp.openEnded as Array<{ id: string; q: string }>)
    : []

  let body: QuizResponseBody
  try {
    body = (await req.json()) as QuizResponseBody
  } catch {
    return jsonError('BAD_REQUEST', 'Invalid JSON body', 400)
  }

  const { questionId, answer, answerText } = body
  if (!questionId || typeof questionId !== 'string') {
    return jsonError('BAD_REQUEST', 'questionId is required', 400)
  }
  if (typeof answer !== 'number') {
    return jsonError('BAD_REQUEST', 'answer must be a number', 400)
  }

  // Determine if this is an MCQ or open-ended question.
  const mcq = mcqs.find((m) => m.id === questionId)
  const oe = openEnded.find((o) => o.id === questionId)
  if (!mcq && !oe) return jsonError('NOT_FOUND', 'Question not found in this session', 404)

  // Evaluate correctness for MCQ.
  let isCorrect: boolean | null = null
  if (mcq) {
    if (answer < 0 || answer >= mcq.options.length) {
      return jsonError('BAD_REQUEST', `answer must be 0–${mcq.options.length - 1}`, 400)
    }
    isCorrect = answer === mcq.correct
  }

  await db.sessionQuizResponse.upsert({
    where: {
      sessionId_userId_questionId: {
        sessionId,
        userId: auth.user.id,
        questionId,
      },
    },
    create: {
      sessionId,
      userId: auth.user.id,
      questionId,
      answer,
      answerText: answer === -1 ? (answerText ?? null) : null,
      isCorrect,
    },
    update: {
      answer,
      answerText: answer === -1 ? (answerText ?? null) : null,
      isCorrect,
      submittedAt: new Date(),
    },
  })

  return jsonOk({ sessionId, questionId, answer, isCorrect })
}

export const POST = handle
export const PATCH = handle

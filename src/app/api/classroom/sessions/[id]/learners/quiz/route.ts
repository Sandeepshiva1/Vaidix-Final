// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/learners/quiz
// ════════════════════════════════════════════════════════════════════════════
// AI-generates priming quiz questions (MCQs + open-ended) for a session FROM its
// uploaded preread material. Generation is gated on material: with no linked
// preread document the service throws and we return 422 MATERIAL_REQUIRED. When
// the AI provider is unreachable we return 503 GENERATOR_OFFLINE — never
// fabricated content.
//
// This route does NOT persist: the generated questions are returned as editable
// drafts that the faculty tweaks in the "Prepare Learners" editor and commits
// via PATCH /learners (the existing save path).
//
// Access: session host or FACULTY / PROGRAM_DIRECTOR / ADMIN only. Requires the
// CSRF double-submit token.

import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { GeminiUnavailableError } from '@/server/services/ai/gemini';
import {
  generateQuizQuestions,
  QuizMaterialError,
  type QuizQuestions,
} from '@/server/services/learners/quiz-questions-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

async function loadGate(sessionId: string, userId: string, role: Role) {
  const row = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true },
  });
  if (!row) return { ok: false as const, response: jsonError('NOT_FOUND', 'Session not found', 404) };
  const isHost = row.hostId === userId;
  if (!isHost && !FACULTY_LIKE.includes(role)) {
    return { ok: false as const, response: jsonError('FORBIDDEN', 'Faculty or host only', 403) };
  }
  return { ok: true as const, row };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const { id: sessionId } = await ctx.params;
  try {
    const gate = await loadGate(sessionId, auth.user.id, auth.user.role);
    if (!gate.ok) return gate.response;

    let quiz: QuizQuestions;
    try {
      quiz = await generateQuizQuestions({ sessionId });
    } catch (err) {
      if (err instanceof QuizMaterialError) {
        return jsonError(
          'MATERIAL_REQUIRED',
          err.message,
          422,
        );
      }
      if (err instanceof GeminiUnavailableError) {
        console.error('[learners/quiz] question generator AI unavailable', err.detail);
        return jsonError(
          'GENERATOR_OFFLINE',
          'The AI question builder is offline — generation is unavailable right now.',
          503,
        );
      }
      throw err;
    }

    return jsonOk({ sessionId, quiz });
  } catch (err) {
    return handleUnexpected(err);
  }
}

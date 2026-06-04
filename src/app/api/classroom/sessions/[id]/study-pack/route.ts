// ════════════════════════════════════════════════════════════════════════════
// GET /api/classroom/sessions/[id]/study-pack
// ════════════════════════════════════════════════════════════════════════════
// Returns the resident-facing Study Pack: pre-readings + pre-watch videos +
// pre-cases (with each item's `viewedByMe` flag). Anyone with visibility into
// the session can call this. Faculty / PD see the same data — the curator UI
// uses /api/classroom/sessions/[id]/study-pack/documents to mutate.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  listStudyPackDocuments,
  listStudyPackAiContent,
  StudyPackAccessError,
} from '@/server/services/study-pack/study-pack-service';
import { listPreCasesForLearner } from '@/server/services/study-pack/pre-case-service';

function statusFor(code: string): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  try {
    const actor = { userId: auth.user.id, role: auth.user.role };
    const [docs, preCases, ai] = await Promise.all([
      listStudyPackDocuments(sessionId, actor),
      listPreCasesForLearner(sessionId, actor),
      listStudyPackAiContent(sessionId, actor),
    ]);
    return jsonOk({
      sessionId,
      readings: docs.readings,
      videos: docs.videos,
      preCases,
      quiz: ai.quiz,
      flashcards: ai.flashcards,
    });
  } catch (err) {
    if (err instanceof StudyPackAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

// PATCH /api/classroom/sessions/:id/qa/:qaId/answer
//
// Mark an existing Q&A question as officially answered (or clear the answer
// when `answer` is null/empty). Only FACULTY/PD/ADMIN/host. Audited.

import { z } from 'zod';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import { answerQuestion, QaError } from '@/server/services/qa/qa-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const bodySchema = z.object({
  answer: z.string().trim().max(8000).nullable(),
});

function mapQaError(err: unknown): Response | null {
  if (!(err instanceof QaError)) return null;
  if (err.code === 'NOT_FOUND') return jsonError('NOT_FOUND', err.message, 404);
  if (err.code === 'FORBIDDEN') return jsonError('FORBIDDEN', err.message, 403);
  return jsonError('INVALID', err.message, 400);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; qaId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;

    const { id: sessionId, qaId } = await ctx.params;

    const result = await answerQuestion(
      { userId: gate.user.id, role: gate.user.role },
      sessionId,
      qaId,
      body.data.answer
    );

    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: result.answered ? AUDIT_EVENTS.QA_QUESTION_ANSWERED : AUDIT_EVENTS.QA_ANSWER_CLEARED,
      entityType: 'QaItem',
      entityId: qaId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId },
    });

    return jsonOk(result);
  } catch (err) {
    return mapQaError(err) ?? handleUnexpected(err);
  }
}

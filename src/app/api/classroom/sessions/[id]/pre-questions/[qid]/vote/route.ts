// vote / unvote a pre-question
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { setVote, PreQuestionError } from '@/server/services/pre-questions/pre-questions-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { mapPreQuestionError } from '../../route';

export async function POST(req: Request, ctx: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id, qid } = await ctx.params;
    const result = await setVote({ userId: gate.user.id, role: gate.user.role }, id, qid, true);
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.PRE_QUESTION_VOTED,
      entityType: 'PreSessionQuestion',
      entityId: qid,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id, voteCount: result.voteCount },
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof PreQuestionError) {
      const mapped = mapPreQuestionError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id, qid } = await ctx.params;
    const result = await setVote({ userId: gate.user.id, role: gate.user.role }, id, qid, false);
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.PRE_QUESTION_UNVOTED,
      entityType: 'PreSessionQuestion',
      entityId: qid,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id, voteCount: result.voteCount },
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof PreQuestionError) {
      const mapped = mapPreQuestionError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

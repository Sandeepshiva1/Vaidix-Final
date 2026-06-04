// Q&A reply (single-level only; service enforces no nested replies)
import { z } from 'zod';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import { postReply, QaError } from '@/server/services/qa/qa-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const replySchema = z.object({
  question: z.string().trim().min(2).max(2000),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; qaId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, replySchema);
    if (!body.ok) return body.response;
    const { id, qaId } = await ctx.params;
    const created = await postReply(
      { userId: gate.user.id, role: gate.user.role },
      id,
      qaId,
      body.data
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.QA_REPLY_POSTED,
      entityType: 'QaItem',
      entityId: created.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id, parentId: qaId },
    });
    return jsonOk({ id: created.id }, { status: 201 });
  } catch (err) {
    if (err instanceof QaError) {
      if (err.code === 'NOT_FOUND') return jsonError('NOT_FOUND', err.message, 404);
      if (err.code === 'INVALID') return jsonError('INVALID', err.message, 400);
      if (err.code === 'FORBIDDEN') return jsonError('FORBIDDEN', err.message, 403);
      if (err.code === 'RECORDING_NOT_READY')
        return jsonError('RECORDING_NOT_READY', err.message, 409);
    }
    return handleUnexpected(err);
  }
}

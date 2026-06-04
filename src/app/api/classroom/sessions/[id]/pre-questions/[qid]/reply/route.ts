// POST a single-level reply to a pre-conference question.
// Mirrors the QaItem /reply route convention so the API surface is consistent
// across live Q&A and pre-conference Q&A.

import { z } from 'zod';
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import {
  postReply,
  PreQuestionError,
} from '@/server/services/pre-questions/pre-questions-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { mapPreQuestionError } from '../../route';

const replySchema = z.object({
  content: z.string().trim().min(2).max(2000),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, replySchema);
    if (!body.ok) return body.response;
    const { id, qid } = await ctx.params;
    const created = await postReply(
      { userId: gate.user.id, role: gate.user.role },
      id,
      qid,
      body.data
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.PRE_QUESTION_REPLY_POSTED,
      entityType: 'PreSessionQuestion',
      entityId: created.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id, parentId: qid },
    });
    return jsonOk({ id: created.id }, { status: 201 });
  } catch (err) {
    if (err instanceof PreQuestionError) {
      const mapped = mapPreQuestionError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

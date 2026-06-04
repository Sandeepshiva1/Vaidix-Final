// append a resident message; the service generates the next mentor
// reply (Gemini ) and advances the Socratic stage.
import { z } from 'zod';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import { sendMessage, CasesError } from '@/server/services/cases/cases-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { ConversationStatus } from '@prisma/client';

const schema = z.object({
  content: z.string().trim().min(1).max(4000),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ caseTemplateId: string; conversationId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const { conversationId } = await ctx.params;
    const result = await sendMessage(
      { userId: gate.user.id, role: gate.user.role },
      conversationId,
      body.data.content
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.CASE_MESSAGE_SENT,
      entityType: 'Conversation',
      entityId: conversationId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { stage: result.newStage },
    });
    if (result.conversationStatus === ConversationStatus.COMPLETED) {
      await audit({
        actorId: gate.user.id,
        actorRole: gate.user.role,
        eventType: AUDIT_EVENTS.CASE_COMPLETED,
        entityType: 'Conversation',
        entityId: conversationId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof CasesError) {
      if (err.code === 'NOT_FOUND') return jsonError('NOT_FOUND', err.message, 404);
      if (err.code === 'FORBIDDEN') return jsonError('FORBIDDEN', err.message, 403);
      if (err.code === 'CONVERSATION_CLOSED')
        return jsonError('CONVERSATION_CLOSED', err.message, 409);
      return jsonError('INVALID', err.message, 400);
    }
    return handleUnexpected(err);
  }
}

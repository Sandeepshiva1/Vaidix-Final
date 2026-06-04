// list + submit pre-conference questions
import { z } from 'zod';
import { PreSessionQuestionUrgency } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import {
  listQuestions,
  submitQuestion,
  PreQuestionError,
} from '@/server/services/pre-questions/pre-questions-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const submitSchema = z.object({
  content: z.string().trim().min(5).max(500),
  urgency: z.nativeEnum(PreSessionQuestionUrgency).optional(),
});

export function mapPreQuestionError(err: unknown): Response | null {
  if (!(err instanceof PreQuestionError)) return null;
  switch (err.code) {
    case 'NOT_FOUND':
      return jsonError('NOT_FOUND', err.message, 404);
    case 'FORBIDDEN':
      return jsonError('FORBIDDEN', err.message, 403);
    case 'SESSION_NOT_VISIBLE':
      return jsonError('SESSION_NOT_VISIBLE', err.message, 403);
    case 'CLUSTER_FAILED':
      return jsonError('CLUSTER_FAILED', err.message, 502);
    default:
      return jsonError('INVALID', err.message, 400);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const items = await listQuestions({ userId: gate.user.id, role: gate.user.role }, id);
    return jsonOk({ items });
  } catch (err) {
    return mapPreQuestionError(err) ?? handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, submitSchema);
    if (!body.ok) return body.response;
    const { id } = await ctx.params;
    const created = await submitQuestion(
      { userId: gate.user.id, role: gate.user.role },
      id,
      body.data
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.PRE_QUESTION_SUBMITTED,
      entityType: 'PreSessionQuestion',
      entityId: created.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id, urgency: body.data.urgency ?? 'NORMAL' },
    });
    return jsonOk({ id: created.id }, { status: 201 });
  } catch (err) {
    return mapPreQuestionError(err) ?? handleUnexpected(err);
  }
}

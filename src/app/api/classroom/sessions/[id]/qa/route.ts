// W5 — Q&A list + create
import { z } from 'zod';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import { listQa, postQuestion, QaError } from '@/server/services/qa/qa-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const postSchema = z.object({
  timestampSec: z.number().int().min(0),
  question: z.string().trim().min(2).max(2000),
});

function mapQaError(err: unknown): Response | null {
  if (!(err instanceof QaError)) return null;
  if (err.code === 'NOT_FOUND') return jsonError('NOT_FOUND', err.message, 404);
  if (err.code === 'FORBIDDEN') return jsonError('FORBIDDEN', err.message, 403);
  if (err.code === 'RECORDING_NOT_READY') return jsonError('RECORDING_NOT_READY', err.message, 409);
  return jsonError('INVALID', err.message, 400);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const items = await listQa({ userId: gate.user.id, role: gate.user.role }, id);
    return jsonOk({ items });
  } catch (err) {
    return mapQaError(err) ?? handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, postSchema);
    if (!body.ok) return body.response;
    const { id } = await ctx.params;
    const created = await postQuestion(
      { userId: gate.user.id, role: gate.user.role },
      id,
      body.data
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.QA_QUESTION_POSTED,
      entityType: 'QaItem',
      entityId: created.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id, timestampSec: body.data.timestampSec },
    });
    return jsonOk({ id: created.id }, { status: 201 });
  } catch (err) {
    return mapQaError(err) ?? handleUnexpected(err);
  }
}

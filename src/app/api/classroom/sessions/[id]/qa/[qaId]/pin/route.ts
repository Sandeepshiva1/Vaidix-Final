// pin / unpin a Q&A item (host, PD, or admin only)
import { z } from 'zod';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import { setPinned, QaError } from '@/server/services/qa/qa-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const schema = z.object({ pinned: z.boolean() });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; qaId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const { id, qaId } = await ctx.params;
    await setPinned(
      { userId: gate.user.id, role: gate.user.role },
      id,
      qaId,
      body.data.pinned
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: body.data.pinned ? AUDIT_EVENTS.QA_PINNED : AUDIT_EVENTS.QA_UNPINNED,
      entityType: 'QaItem',
      entityId: qaId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id },
    });
    return jsonOk({ pinned: body.data.pinned });
  } catch (err) {
    if (err instanceof QaError) {
      if (err.code === 'NOT_FOUND') return jsonError('NOT_FOUND', err.message, 404);
      if (err.code === 'FORBIDDEN') return jsonError('FORBIDDEN', err.message, 403);
      if (err.code === 'INVALID') return jsonError('INVALID', err.message, 400);
    }
    return handleUnexpected(err);
  }
}

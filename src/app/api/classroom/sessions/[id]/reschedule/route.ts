import { jsonOk, jsonError, requireAuth, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { rescheduleSession } from '@/server/services/session-service';
import { rescheduleSchema } from '@/lib/validation/session';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const body = await parseBody(req, rescheduleSchema);
    if (!body.ok) return body.response;

    const { session, hostConflicts } = await rescheduleSession(id, gate.user.id, gate.user.role, body.data);
    return jsonOk({ session, warnings: { hostConflicts } });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_PROPOSER') return jsonError('FORBIDDEN', 'Only the proposer or admin can reschedule', 403);
    if (msg === 'ALREADY_CANCELLED') return jsonError('CONFLICT', 'Session already cancelled', 409);
    return handleUnexpected(err);
  }
}

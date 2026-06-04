import { jsonOk, jsonError, requireAuth, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { rejectSession } from '@/server/services/session-service';
import { rejectSessionSchema } from '@/lib/validation/session';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const body = await parseBody(req, rejectSessionSchema);
    if (!body.ok) return body.response;

    const session = await rejectSession(id, gate.user.id, gate.user.role, body.data.reason);
    return jsonOk({ session });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_PENDING') return jsonError('NOT_PENDING', 'Session is not awaiting approval', 409);
    if (msg === 'NOT_DESIGNATED_HOST') return jsonError('FORBIDDEN', 'Only the designated host may reject', 403);
    return handleUnexpected(err);
  }
}

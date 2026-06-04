import { jsonOk, jsonError, requireAuth, handleUnexpected, parseBody } from '@/server/services/api-helpers';
import { getSession, cancelSession, updateSession } from '@/server/services/session-service';
import { cancelSessionSchema, updateSessionSchema } from '@/lib/validation/session';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const session = await getSession(id);
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    return jsonOk({ session });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const body = await parseBody(req, updateSessionSchema);
    if (!body.ok) return body.response;

    const session = await updateSession(id, gate.user.id, gate.user.role, body.data);
    return jsonOk({ session });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host/proposer/admin can update', 403);
    if (msg === 'COHORT_NOT_FOUND') return jsonError('COHORT_NOT_FOUND', 'Cohort not found', 404);
    if (msg === 'COHORT_PROGRAM_MISMATCH') return jsonError('COHORT_PROGRAM_MISMATCH', 'Cohort belongs to a different program', 400);
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const body = await parseBody(req, cancelSessionSchema);
    if (!body.ok) return body.response;

    await cancelSession(id, gate.user.id, gate.user.role, body.data.reason);
    return jsonOk({ cancelled: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host/proposer/admin can cancel', 403);
    return handleUnexpected(err);
  }
}

// POST — host promotes a participant to co-host; DELETE — demotes
import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { promoteToCoHost, demoteFromCoHost } from '@/server/services/session-service';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; identity: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id, identity } = await ctx.params;
    await promoteToCoHost(id, identity, gate.user.id, gate.user.role);
    return jsonOk({ promoted: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_HOST') return jsonError('FORBIDDEN', 'Only host or admin may promote', 403);
    return handleUnexpected(err);
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; identity: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id, identity } = await ctx.params;
    await demoteFromCoHost(id, identity, gate.user.id, gate.user.role);
    return jsonOk({ demoted: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_HOST') return jsonError('FORBIDDEN', 'Only host or admin may demote', 403);
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/classroom/sessions/[id]/invites/[userId]
// ════════════════════════════════════════════════════════════════════════════
// Removes a single invitee from an INVITE_ONLY session. Host / proposer /
// admin only. Does NOT remove them from any SessionAdmission record — that's
// a separate flow.

import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { removeSessionInvitee } from '@/server/services/session-service';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const { id, userId } = await ctx.params;
    await removeSessionInvitee(id, userId, gate.user.id, gate.user.role);
    return jsonOk({ removed: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_INVITE_ONLY') return jsonError('NOT_INVITE_ONLY', 'Session is not INVITE_ONLY', 409);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host, proposer, or admin may manage invites', 403);
    if (msg === 'INVITE_NOT_FOUND') return jsonError('NOT_FOUND', 'Invite not found', 404);
    return handleUnexpected(err);
  }
}

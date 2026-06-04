// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/users/[id]/status
// ════════════════════════════════════════════════════════════════════════════
// Admin transitions a user's status (ACTIVE / SUSPENDED / DEACTIVATED).
// Bumping passwordVersion on suspension/deactivation invalidates live sessions.

import {
  jsonOk,
  jsonError,
  parseBody,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { Role } from '@prisma/client';
import { changeUserStatus } from '@/server/services/user-admin-service';
import { updateUserStatusSchema } from '@/lib/validation/auth';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const body = await parseBody(req, updateUserStatusSchema);
    if (!body.ok) return body.response;

    const { id } = await ctx.params;
    const result = await changeUserStatus({
      targetUserId: id,
      newStatus: body.data.status,
      actorId: gate.user.id,
      reason: body.data.reason ?? null,
    });
    return jsonOk(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'USER_NOT_FOUND') return jsonError('NOT_FOUND', 'User not found', 404);
    if (msg === 'CANNOT_MODIFY_SELF') return jsonError('FORBIDDEN', 'You cannot change your own status', 403);
    if (msg === 'USER_NOT_ONBOARDED') {
      return jsonError(
        'USER_NOT_ONBOARDED',
        'User has not accepted their invitation yet; manage via the invitations inbox',
        409
      );
    }
    return handleUnexpected(err);
  }
}

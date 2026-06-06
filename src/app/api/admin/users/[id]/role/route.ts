// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/users/[id]/role
// ════════════════════════════════════════════════════════════════════════════
// Admin changes a user's role. Writes UserRoleHistory + audit entry.

import {
  jsonOk,
  jsonError,
  parseBody,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { Role } from '@prisma/client';
import { changeUserRole } from '@/server/services/user-admin-service';
import { ADMIN_LIMIT_CODE, adminLimitMessage } from '@/server/services/admin-limits';
import { updateUserRoleSchema } from '@/lib/validation/auth';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const body = await parseBody(req, updateUserRoleSchema);
    if (!body.ok) return body.response;

    const { id } = await ctx.params;
    const result = await changeUserRole({
      targetUserId: id,
      newRole: body.data.role,
      actorId: gate.user.id,
      reason: body.data.reason ?? null,
    });
    return jsonOk(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'USER_NOT_FOUND') return jsonError('NOT_FOUND', 'User not found', 404);
    if (msg === 'CANNOT_MODIFY_SELF') return jsonError('FORBIDDEN', 'You cannot change your own role', 403);
    if (msg === ADMIN_LIMIT_CODE) return jsonError('ADMIN_LIMIT', adminLimitMessage, 409);
    return handleUnexpected(err);
  }
}

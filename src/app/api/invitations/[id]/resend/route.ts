import { Role } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { resendInvitation } from '@/server/services/invitation-service';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    try {
      const inv = await resendInvitation(id, gate.user.name);
      return jsonOk({
        invitation: {
          id: inv.id,
          email: inv.email,
          expiresAt: inv.expiresAt,
          resendCount: inv.resendCount,
        },
      });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'NOT_FOUND') return jsonError('NOT_FOUND', 'Invitation not found', 404);
      if (code === 'ALREADY_ACCEPTED') return jsonError('ALREADY_ACCEPTED', 'User already accepted', 409);
      if (code === 'REVOKED') return jsonError('REVOKED', 'Cannot resend a revoked invitation', 409);
      throw err;
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}

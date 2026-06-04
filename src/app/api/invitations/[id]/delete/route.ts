import { Role } from '@prisma/client';
import { deleteInvitationSchema } from '@/lib/validation/auth';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { deleteInvitation } from '@/server/services/invitation-service';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(req, deleteInvitationSchema);
    if (!parsed.ok) return parsed.response;

    const { id } = await ctx.params;
    try {
      await deleteInvitation(id, gate.user.id, parsed.data.reason);
      return jsonOk({ message: 'Invitation permanently deleted' });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'NOT_FOUND') return jsonError('NOT_FOUND', 'Invitation not found', 404);
      if (code === 'ALREADY_ACCEPTED') return jsonError('ALREADY_ACCEPTED', 'Cannot delete — user already registered', 409);
      throw err;
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}

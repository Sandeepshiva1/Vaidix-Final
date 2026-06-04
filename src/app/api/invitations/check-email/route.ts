import { db } from '@/lib/db';
import { Role, InvitationStatus } from '@prisma/client';
import { emailSchema } from '@/lib/validation/primitives';
import {
  jsonOk,
  jsonError,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';

// GET /api/invitations/check-email?email=xxx
// Returns whether the email can be used for a NEW invitation. Excluded
// from the "available" check: existing user accounts AND any currently
// PENDING invitation. Revoked / expired invitations do not block.
export async function GET(req: Request) {
  try {
    const gate = await requireRole(Role.ADMIN, Role.PROGRAM_DIRECTOR);
    if (!gate.ok) return gate.response;

    const url = new URL(req.url);
    const raw = url.searchParams.get('email') ?? '';
    const parsed = emailSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError('INVALID_EMAIL', 'Invalid email address', 422);
    }
    const email = parsed.data;

    const [user, pendingInvite] = await Promise.all([
      db.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, status: true } }),
      db.invitation.findFirst({
        where: { email, status: InvitationStatus.PENDING },
        select: { id: true, fullName: true, role: true, expiresAt: true },
      }),
    ]);

    if (user) {
      return jsonOk({
        available: false,
        reason: 'USER_EXISTS',
        user: { name: user.name, role: user.role, status: user.status },
      });
    }
    if (pendingInvite) {
      return jsonOk({
        available: false,
        reason: 'PENDING_INVITE',
        invitation: {
          id: pendingInvite.id,
          fullName: pendingInvite.fullName,
          role: pendingInvite.role,
          expiresAt: pendingInvite.expiresAt,
        },
      });
    }
    return jsonOk({ available: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

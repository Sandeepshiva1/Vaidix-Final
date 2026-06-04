import { db } from '@/lib/db';
import { InvitationStatus } from '@prisma/client';
import { jsonOk, jsonError, handleUnexpected } from '@/server/services/api-helpers';

// Public endpoint: validate invitation token. Used by /invitations/[token] page
// to display invite details before showing the set-password form.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token || token.length < 16) {
      return jsonError('INVALID_TOKEN', 'Invalid invitation link', 400);
    }

    const inv = await db.invitation.findUnique({
      where: { token },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        subspecialty: true,
        department: true,
        yearOfResidency: true,
        status: true,
        expiresAt: true,
        invitedBy: { select: { name: true, email: true } },
      },
    });

    if (!inv) return jsonError('INVALID_TOKEN', 'Invalid invitation link', 404);
    if (inv.status === InvitationStatus.ACCEPTED) {
      return jsonError('ALREADY_ACCEPTED', 'This invitation has already been used', 410);
    }
    if (inv.status === InvitationStatus.REVOKED) {
      return jsonError('REVOKED', 'This invitation has been revoked', 410);
    }
    if (inv.status === InvitationStatus.EXPIRED || inv.expiresAt < new Date()) {
      return jsonError('EXPIRED', 'This invitation has expired', 410);
    }

    return jsonOk({ invitation: inv });
  } catch (err) {
    return handleUnexpected(err);
  }
}

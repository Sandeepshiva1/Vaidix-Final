// ════════════════════════════════════════════════════════════════════════════
// GET /api/users/pending
// ════════════════════════════════════════════════════════════════════════════
// Lists all users whose onboarding is still open: PENDING_INVITE user rows
// (those who've been invited but never accepted) alongside their originating
// Invitation record. Admin and Program Director only.

import { jsonOk, requireRole, handleUnexpected } from '@/server/services/api-helpers';
import { Role, UserStatus, InvitationStatus } from '@prisma/client';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const gate = await requireRole(Role.ADMIN, Role.PROGRAM_DIRECTOR);
    if (!gate.ok) return gate.response;

    const pendingUsers = await db.user.findMany({
      where: { status: UserStatus.PENDING_INVITE, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000, // bound the response; admin onboarding queue is reviewed, not paged
    });

    const openInvitations = await db.invitation.findMany({
      where: { status: InvitationStatus.PENDING },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        expiresAt: true,
        resendCount: true,
        lastResentAt: true,
        createdAt: true,
        invitedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    return jsonOk({
      pendingUsers,
      openInvitations,
      counts: {
        pendingUsers: pendingUsers.length,
        openInvitations: openInvitations.length,
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

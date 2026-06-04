// W5 — end a single breakout (faculty/PD/admin)
// Symmetric subset of reconvene that ends just one of the breakouts.
import { db } from '@/lib/db';
import { BreakoutStatus, Role } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { deleteRoom } from '@/lib/livekit';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; breakoutId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id, breakoutId } = await ctx.params;

    const breakout = await db.breakout.findUnique({
      where: { id: breakoutId },
      select: { id: true, sessionId: true, status: true, livekitRoomName: true, session: { select: { hostId: true } } },
    });
    if (!breakout) return jsonError('NOT_FOUND', 'Breakout not found', 404);
    if (breakout.sessionId !== id) {
      return jsonError('INVALID', 'Breakout does not belong to this session', 400);
    }
    const isPrivileged =
      gate.user.role === Role.ADMIN ||
      gate.user.role === Role.PROGRAM_DIRECTOR ||
      breakout.session.hostId === gate.user.id;
    if (!isPrivileged) return jsonError('FORBIDDEN', 'Only host, PD, or admin', 403);
    if (breakout.status !== BreakoutStatus.ACTIVE) {
      return jsonOk({ alreadyEnded: true });
    }

    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.breakout.update({
        where: { id: breakoutId },
        data: { status: BreakoutStatus.ENDED, endedAt: now, endedById: gate.user.id },
      });
      await tx.breakoutParticipant.updateMany({
        where: { breakoutId, leftAt: null },
        data: { leftAt: now },
      });
    });
    try {
      await deleteRoom(breakout.livekitRoomName);
    } catch (err) {
      console.warn(`[breakouts] failed to delete LiveKit room ${breakout.livekitRoomName}:`, err);
    }

    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.BREAKOUT_ENDED,
      entityType: 'Breakout',
      entityId: breakoutId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id },
    });

    return jsonOk({ ended: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

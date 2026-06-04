// DELETE — host removes participant from room + adds SessionBan
import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { removeParticipant, sessionRoomName } from '@/lib/livekit';
import { audit } from '@/server/services/audit';
import { sessionAudit, SESSION_AUDIT } from '@/server/services/session-audit';
import { Role } from '@prisma/client';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; identity: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id: sessionId, identity } = await ctx.params;

    // Authorization: host or co-host or admin
    const session = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { hostId: true },
    });
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    const isAdmin = gate.user.role === Role.ADMIN;
    const isHost = session.hostId === gate.user.id;
    let isCoHost = false;
    if (!isHost && !isAdmin) {
      const part = await db.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId: gate.user.id } },
        select: { role: true },
      });
      isCoHost = part?.role === 'CO_HOST';
    }
    if (!isHost && !isCoHost && !isAdmin) {
      return jsonError('FORBIDDEN', 'Only host, co-host, or admin may remove', 403);
    }

    const url = new URL(req.url);
    const ban = url.searchParams.get('ban') === 'true';
    const reason = url.searchParams.get('reason') ?? undefined;

    try {
      await removeParticipant(sessionRoomName(sessionId), identity);
    } catch {
      // LiveKit may return 404 if already left — that's fine
    }

    if (ban) {
      await db.sessionBan.upsert({
        where: { sessionId_userId: { sessionId, userId: identity } },
        create: { sessionId, userId: identity, bannedBy: gate.user.id, reason },
        update: { reason },
      });
    }

    await audit({
      actorId: gate.user.id,
      eventType: ban ? 'SESSION_PARTICIPANT_BANNED' : 'SESSION_PARTICIPANT_REMOVED',
      entityType: 'teaching_session',
      entityId: sessionId,
      summary: `${ban ? 'Banned' : 'Removed'} ${identity}${reason ? `: ${reason}` : ''}`,
    });
    await sessionAudit({
      sessionId,
      eventType: ban ? SESSION_AUDIT.PARTICIPANT_BANNED : SESSION_AUDIT.PARTICIPANT_KICKED,
      actorId: gate.user.id,
      targetUserId: identity,
      details: reason ? { reason } : undefined,
    });

    return jsonOk({ removed: true, banned: ban });
  } catch (err) {
    return handleUnexpected(err);
  }
}

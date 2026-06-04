// GET — returns the user IDs of participants promoted to CO_HOST in this session.
// Used by the host's participant sidebar to seed the promotedSet on mount/reload
// so existing co-hosts show the "Co-host" badge instead of the "Promote" button.
import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id: sessionId } = await ctx.params;

    const session = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { hostId: true },
    });
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);

    const isHost = session.hostId === gate.user.id;
    const isAdmin = gate.user.role === Role.ADMIN;
    // Co-hosts also call this so they can see their own badge — allow them too.
    const coHostRow = isHost || isAdmin ? null : await db.sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: gate.user.id } },
      select: { role: true },
    });
    const isCoHost = coHostRow?.role === 'CO_HOST';
    if (!isHost && !isAdmin && !isCoHost) {
      return jsonError('FORBIDDEN', 'Moderators only', 403);
    }

    const coHosts = await db.sessionParticipant.findMany({
      where: { sessionId, role: 'CO_HOST' },
      select: { userId: true },
    });

    return jsonOk({ coHostIds: coHosts.map((p) => p.userId) });
  } catch (err) {
    return handleUnexpected(err);
  }
}

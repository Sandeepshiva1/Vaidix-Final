// GET — list pending admissions (host/co-host)
// Lightweight polling endpoint; real-time push can come later.
import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { listPending } from '@/server/services/admission-service';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id: sessionId } = await ctx.params;

    // Only host / co-host / admin may see pending list
    if (gate.user.role !== Role.ADMIN) {
      const session = await db.teachingSession.findUnique({
        where: { id: sessionId },
        select: { hostId: true },
      });
      if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
      if (session.hostId !== gate.user.id) {
        const part = await db.sessionParticipant.findUnique({
          where: { sessionId_userId: { sessionId, userId: gate.user.id } },
          select: { role: true },
        });
        if (part?.role !== 'CO_HOST') {
          return jsonError('FORBIDDEN', 'Only host or co-host may view admissions', 403);
        }
      }
    }

    const pending = await listPending(sessionId);
    return jsonOk({ pending });
  } catch (err) {
    return handleUnexpected(err);
  }
}

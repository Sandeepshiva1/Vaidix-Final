// GET /api/classroom/sessions/[id]/hooks/[hookId]/results — W9.4
// Aggregate vote counts for a hook. Mentimeter-style policy:
//   - host / PD / admin always see results
//   - resident sees results only after they have answered (anti-bias)
// The myAnswer field lets the voter UI highlight the resident's own pick.

import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import { getHookResults } from '@/server/services/hooks/hooks-service';
import { db } from '@/lib/db';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; hookId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId, hookId } = await ctx.params;

  try {
    const results = await getHookResults(hookId, { userId: auth.user.id, role: auth.user.role });
    // Authorization: host/PD/admin always allowed. Residents only see
    // results after they've answered — otherwise they could see how others
    // voted before forming their own opinion.
    if (auth.user.role !== Role.ADMIN && auth.user.role !== Role.PROGRAM_DIRECTOR) {
      const session = await db.teachingSession.findUnique({
        where: { id: sessionId },
        select: { hostId: true },
      });
      const isHost = session?.hostId === auth.user.id;
      if (!isHost && results.myAnswer === null) {
        return jsonError('VOTE_FIRST', 'Cast your vote to see results', 403, {
          total: results.total,
        });
      }
    }
    return jsonOk(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/not found/i.test(msg)) return jsonError('NOT_FOUND', msg, 404);
    return handleUnexpected(err);
  }
}

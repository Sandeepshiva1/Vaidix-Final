// ════════════════════════════════════════════════════════════════════════════
// GET /api/promo/teaser-video/sources?sessionId=… — preview the AI inputs
// ════════════════════════════════════════════════════════════════════════════
// Returns the same digest the teaser worker passes to Gemini (objectives,
// study material, top pre-questions, tags). Curators see this BEFORE clicking
// "Generate" so the AI's source data is transparent — no more black-box copy.
//
// Same RBAC as POST /api/promo/teaser-video: faculty (host only), PD, admin.

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseQuery,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { gatherTeaserSources } from '@/server/services/promo/teaser-sources';

const querySchema = z.object({ sessionId: z.string().min(1) });

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Only faculty / PD / admin can preview teaser sources', 403);
  }
  const q = await parseQuery(req, querySchema);
  if (!q.ok) return q.response;

  try {
    const sources = await gatherTeaserSources(q.data.sessionId);
    if (!sources) return jsonError('NOT_FOUND', 'Session not found', 404);

    // Faculty can only inspect sessions they host. PD/Admin can do any session.
    if (auth.user.role === Role.FACULTY) {
      const session = await db.teachingSession.findUnique({
        where: { id: q.data.sessionId },
        select: { hostId: true },
      });
      if (!session || session.hostId !== auth.user.id) {
        return jsonError('FORBIDDEN', 'Only the session host can preview teaser sources', 403);
      }
    }

    return jsonOk({ sessionId: sources.sessionId, sources });
  } catch (err) {
    return handleUnexpected(err);
  }
}

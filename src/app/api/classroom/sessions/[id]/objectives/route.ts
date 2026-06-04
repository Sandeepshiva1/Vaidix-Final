// ════════════════════════════════════════════════════════════════════════════
// GET /api/classroom/sessions/[id]/objectives
// ════════════════════════════════════════════════════════════════════════════
// Returns the structured learning objectives for a session along with the
// current user's achievement marks. Curators edit objectives via the existing
// PATCH /api/classroom/sessions/[id] route — no curator endpoint here.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  readObjectivesWithMyMarks,
  ObjectivesAccessError,
} from '@/server/services/sessions/objectives';

function statusFor(code: string): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  try {
    const objectives = await readObjectivesWithMyMarks({
      sessionId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    return jsonOk({ sessionId, objectives });
  } catch (err) {
    if (err instanceof ObjectivesAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

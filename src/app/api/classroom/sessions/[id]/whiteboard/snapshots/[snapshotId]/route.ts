// GET /api/classroom/sessions/[id]/whiteboard/snapshots/[snapshotId]
//   Returns a single snapshot blob — used by the recording-viewer scrub when
//   the user lands on a specific point in time and we need to reload the
//   tldraw store to that historical state.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getEffectiveSessionRole } from '@/server/services/session-service';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; snapshotId: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const { id: sessionId, snapshotId } = await ctx.params;

    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    const snap = await db.whiteboardSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        snapshot: true,
        tMs: true,
        createdAt: true,
        authorId: true,
        whiteboard: { select: { sessionId: true } },
      },
    });
    if (!snap || snap.whiteboard.sessionId !== sessionId) {
      return jsonError('NOT_FOUND', 'Snapshot not found', 404);
    }
    return jsonOk({
      snapshot: snap.snapshot,
      id: snap.id,
      tMs: snap.tMs,
      createdAt: snap.createdAt,
      authorId: snap.authorId,
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

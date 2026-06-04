import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { endSession } from '@/server/services/session-service';
import { endRoom, sessionRoomName } from '@/lib/livekit';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;

    await endSession(id, gate.user.id, gate.user.role);
    // Disconnect LiveKit room (best-effort)
    try {
      await endRoom(sessionRoomName(id));
    } catch {
      // Room may not exist (already ended) — ignore
    }
    return jsonOk({ ended: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_HOST') return jsonError('FORBIDDEN', 'Only host or admin may end session', 403);
    return handleUnexpected(err);
  }
}

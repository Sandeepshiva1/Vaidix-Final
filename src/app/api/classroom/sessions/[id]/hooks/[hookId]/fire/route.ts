// POST /api/classroom/sessions/[id]/hooks/[hookId]/fire
// Host triggers a queued hook to go live to all participants.

import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { fireHook } from '@/server/services/hooks/hooks-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export async function POST(req: Request, ctx: { params: Promise<{ id: string; hookId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId, hookId } = await ctx.params;
  try {
    await fireHook(hookId, auth.user.id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_FIRED,
      entityType: 'LiveHook',
      entityId: hookId,
      summary: `Hook fired in session ${sessionId}`,
      details: { sessionId },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ fired: true });
  } catch (err) {
    if (err instanceof Error && /not found|host/.test(err.message)) {
      return jsonError('FORBIDDEN', err.message, 403);
    }
    return handleUnexpected(err);
  }
}

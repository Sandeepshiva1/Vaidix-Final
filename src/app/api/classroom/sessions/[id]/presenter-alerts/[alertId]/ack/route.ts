// POST /api/classroom/sessions/[id]/presenter-alerts/[alertId]/ack
// Marks a presenter alert as acknowledged so the SSE stream stops resending.

import { handleUnexpected, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { acknowledgePresenterAlert } from '@/server/services/engagement/engagement-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; alertId: string }> }
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId, alertId } = await ctx.params;
  try {
    await acknowledgePresenterAlert(alertId, auth.user.id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PRESENTER_ALERT_ACKED,
      entityType: 'PresenterAlert',
      entityId: alertId,
      summary: `Alert acknowledged in session ${sessionId}`,
      details: { sessionId },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ acknowledged: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

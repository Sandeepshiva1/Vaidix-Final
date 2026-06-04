// reconvene: end all ACTIVE breakouts on the session
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import {
  reconveneAll,
  BreakoutError,
} from '@/server/services/breakouts/breakout-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { mapBreakoutError } from '../route';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const result = await reconveneAll(
      { userId: gate.user.id, userName: gate.user.name, role: gate.user.role },
      id
    );
    if (result.ended > 0) {
      const meta = extractRequestMetadata(req);
      await audit({
        actorId: gate.user.id,
        actorRole: gate.user.role,
        eventType: AUDIT_EVENTS.BREAKOUT_RECONVENED,
        entityType: 'TeachingSession',
        entityId: id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        details: { ended: result.ended },
      });
    }
    return jsonOk(result);
  } catch (err) {
    if (err instanceof BreakoutError) {
      const mapped = mapBreakoutError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

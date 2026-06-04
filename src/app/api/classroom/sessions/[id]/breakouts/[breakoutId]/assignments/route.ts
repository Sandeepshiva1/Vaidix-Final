// assign a participant to a breakout
// Faculty/PD/admin: assign anyone. Participants: only self-select mode + own id.
import { z } from 'zod';
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import {
  assignParticipant,
  BreakoutError,
} from '@/server/services/breakouts/breakout-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { mapBreakoutError } from '../../route';

const schema = z.object({
  userId: z.string().min(1),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; breakoutId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const { id, breakoutId } = await ctx.params;
    await assignParticipant(
      { userId: gate.user.id, userName: gate.user.name, role: gate.user.role },
      id,
      breakoutId,
      body.data.userId
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.BREAKOUT_PARTICIPANT_ASSIGNED,
      entityType: 'Breakout',
      entityId: breakoutId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { sessionId: id, targetUserId: body.data.userId, selfSelect: body.data.userId === gate.user.id },
    });
    return jsonOk({ assigned: true });
  } catch (err) {
    if (err instanceof BreakoutError) {
      const mapped = mapBreakoutError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

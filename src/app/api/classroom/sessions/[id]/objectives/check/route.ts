// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/objectives/check
// ════════════════════════════════════════════════════════════════════════════
// Resident self-marks an objective as YES / PARTLY / NO. Upsert keyed by
// (sessionId, userId, objectiveId). Idempotent.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  markObjectiveAchievement,
  ObjectivesAccessError,
} from '@/server/services/sessions/objectives';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { objectiveAchievementSchema } from '@/lib/validation/session';

function statusFor(code: string): number {
  if (code === 'NOT_FOUND' || code === 'OBJECTIVE_NOT_FOUND') return 404;
  if (code === 'FORBIDDEN') return 403;
  return 400;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, objectiveAchievementSchema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;

  // Reuses the high-volume engagement-signal bucket — fail-open.
  const rl = await checkRateLimit({
    bucket: `objective-mark:${auth.user.id}`,
    ...LIMITS.ENGAGEMENT_SIGNAL_WRITE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Objective mark rate exceeded', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await markObjectiveAchievement({
      sessionId,
      actor: { userId: auth.user.id, role: auth.user.role },
      objectiveId: body.data.objectiveId,
      status: body.data.status,
      note: body.data.note ?? null,
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.OBJECTIVE_ACHIEVEMENT_MARKED,
      entityType: 'SessionObjectiveAchievement',
      entityId: result.achievementId,
      summary: `Objective marked ${result.status}`,
      details: {
        sessionId,
        objectiveId: body.data.objectiveId,
        status: body.data.status,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 200 });
  } catch (err) {
    if (err instanceof ObjectivesAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

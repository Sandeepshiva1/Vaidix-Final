// POST /api/classroom/sessions/[id]/engagement-signals
// Records an EngagementSignal for the current user. Used by client-side hooks
// (chat, hand-raise, hook responses, attention pings).
// GET returns the rolling 5-min aggregate (presenter / admin only).

import { z } from 'zod';
import { EngagementSignalKind, Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  aggregateSessionEngagement,
  recordEngagementSignal,
} from '@/server/services/engagement/engagement-service';
import { db } from '@/lib/db';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const writeSchema = z.object({
  kind: z.nativeEnum(EngagementSignalKind),
  value: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, writeSchema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;

  const rl = await checkRateLimit({
    bucket: `eng-signal:${auth.user.id}`,
    ...LIMITS.ENGAGEMENT_SIGNAL_WRITE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Engagement signal rate exceeded', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    await recordEngagementSignal({
      sessionId,
      userId: auth.user.id,
      kind: body.data.kind,
      value: body.data.value,
      metadata: body.data.metadata,
    });
    return jsonOk({ recorded: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  try {
    const session = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { hostId: true },
    });
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    if (
      session.hostId !== auth.user.id &&
      auth.user.role !== Role.ADMIN &&
      auth.user.role !== Role.PROGRAM_DIRECTOR
    ) {
      return jsonError('FORBIDDEN', 'Only host/PD/admin can read aggregates', 403);
    }
    const agg = await aggregateSessionEngagement(sessionId, 5);
    return jsonOk(agg);
  } catch (err) {
    return handleUnexpected(err);
  }
}

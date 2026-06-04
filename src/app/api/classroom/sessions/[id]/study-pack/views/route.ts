// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/study-pack/views — W6.8
// ════════════════════════════════════════════════════════════════════════════
// Resident (or any session-visible user) records that they viewed a pre-session
// item. Body must specify exactly one of: documentLinkId | preCaseId.
// Optional: durationSec (for video tracking via onEnded), completed (true when
// the resident finished the case conversation or watched-to-end).
//
// Side effect: also writes an EngagementSignal of the matching kind so the
// existing aggregator + the W6.8 readiness predictor see the same data.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  recordStudyPackView,
  StudyPackAccessError,
} from '@/server/services/study-pack/study-pack-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const schema = z
  .object({
    documentLinkId: z.string().min(1).optional(),
    preCaseId: z.string().min(1).optional(),
    durationSec: z.number().int().nonnegative().max(60 * 60).optional(),
    completed: z.boolean().optional(),
  })
  .refine((d) => !!(d.documentLinkId || d.preCaseId), {
    message: 'documentLinkId or preCaseId is required',
  });

function statusFor(code: string): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;

  // Reuses the high-volume engagement-signal bucket — fail-open.
  const rl = await checkRateLimit({
    bucket: `study-pack-view:${auth.user.id}`,
    ...LIMITS.ENGAGEMENT_SIGNAL_WRITE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Study-pack view rate exceeded', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await recordStudyPackView({
      sessionId,
      actor: { userId: auth.user.id, role: auth.user.role },
      documentLinkId: body.data.documentLinkId,
      preCaseId: body.data.preCaseId,
      durationSec: body.data.durationSec,
      completed: body.data.completed,
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.STUDY_PACK_VIEW_RECORDED,
      entityType: 'StudyPackView',
      entityId: result.viewId,
      summary: `Study pack view recorded`,
      details: {
        sessionId,
        documentLinkId: body.data.documentLinkId,
        preCaseId: body.data.preCaseId,
        durationSec: body.data.durationSec,
        completed: !!body.data.completed,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof StudyPackAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/promo/teaser-video
// ════════════════════════════════════════════════════════════════════════════
// Faculty / PD / Admin generates a 15-sec silent vertical promo teaser MP4
// for an upcoming session. Returns 202 + the placeholder Document.id; client
// polls GET /api/documents/[id] until the worker has set sizeBytes > 0
// (worker also writes a real MP4 to MinIO at the pre-allocated s3Key).
//
// Why 202 + poll vs sync: render is FFmpeg-bound (~5–8s wall-time on dev
// hardware). Mirrors the reels API contract. See teaser-video-service.ts +
// promo-teaser-worker.ts.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  requestTeaserVideo,
  TeaserVideoAccessError,
} from '@/server/services/promo/teaser-video-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const schema = z.object({
  sessionId: z.string().min(1),
});

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  // Reuses the DOCUMENT_ANALYZE bucket (fail-closed, billable upstream because
  // we call Gemini for the copy + run a render pipeline that ties up workers).
  const rl = await checkRateLimit({
    bucket: `promo-teaser:${auth.user.id}`,
    ...LIMITS.DOCUMENT_ANALYZE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Promo teaser generation throttled', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await requestTeaserVideo({
      sessionId: body.data.sessionId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PROMO_TEASER_REQUESTED,
      entityType: 'Document',
      entityId: result.documentId,
      summary: `Promo teaser video render queued`,
      details: {
        sessionId: body.data.sessionId,
        documentId: result.documentId,
        jobId: result.jobId,
      },
      ...extractRequestMetadata(req),
    });
    // 202 Accepted — render runs async. Client polls /api/documents/[id]
    // until sizeBytes > 0 then plays the signed URL.
    return jsonOk(result, { status: 202 });
  } catch (err) {
    if (err instanceof TeaserVideoAccessError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

// POST /api/classroom/sessions/[id]/objectives/suggest
// Faculty triggers AI-suggested learning objectives derived from the study
// pack the speaker has already uploaded. Returns suggestion chips the
// speaker reviews + accepts individually — nothing is persisted by this
// route. Acceptance still goes through PATCH /api/.../prep with the full
// objective object.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  suggestObjectivesForSession,
  SuggestObjectivesError,
} from '@/server/services/objectives/suggest-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

function statusFor(code: SuggestObjectivesError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'NO_MATERIAL':
      return 422;
    case 'AI_UNAVAILABLE':
      return 503;
    default:
      return 400;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;

  const rl = await checkRateLimit({
    bucket: `obj-suggest:${auth.user.id}`,
    ...LIMITS.DOCUMENT_ANALYZE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Objective suggestion throttled', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await suggestObjectivesForSession({
      sessionId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.OBJECTIVES_AI_SUGGESTED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: `AI suggested ${result.suggestions.length} learning objective${result.suggestions.length === 1 ? '' : 's'}`,
      details: {
        sessionId,
        suggestionCount: result.suggestions.length,
        materialCount: result.materialCount,
        truncated: result.truncated,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof SuggestObjectivesError) {
      // Forward retryAfterSeconds (only set on AI_UNAVAILABLE) so the UI can
      // count down to an enabled Retry button instead of guessing.
      const details = err.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: err.retryAfterSeconds }
        : undefined;
      return jsonError(err.code, err.message, statusFor(err.code), details);
    }
    return handleUnexpected(err);
  }
}

// POST /api/classroom/sessions/[id]/hooks/suggest
// Gemini drafts up to 3 multi-choice polls from the session's objectives +
// uploaded materials. Returns DRAFTS only — the presenter reviews, edits if
// needed, then accepts each by calling the existing POST /hooks endpoint to
// create the row. Same stateless pattern as the objectives + prompts suggest
// endpoints; nothing persists here.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  suggestPollsForSession,
  SuggestPollsError,
} from '@/server/services/polls/suggest-polls-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

function statusFor(code: SuggestPollsError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'NO_CONTEXT':
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
    bucket: `polls-suggest:${auth.user.id}`,
    ...LIMITS.DOCUMENT_ANALYZE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Poll suggestion throttled', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await suggestPollsForSession({
      sessionId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_SUGGESTED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: `AI suggested ${result.polls.length} poll${result.polls.length === 1 ? '' : 's'}`,
      details: { count: result.polls.length },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof SuggestPollsError) {
      const details = err.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: err.retryAfterSeconds }
        : undefined;
      return jsonError(err.code, err.message, statusFor(err.code), details);
    }
    return handleUnexpected(err);
  }
}

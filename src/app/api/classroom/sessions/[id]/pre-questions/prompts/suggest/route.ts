// POST /api/classroom/sessions/[id]/pre-questions/prompts/suggest — W9.3
// Faculty asks Gemini to draft 1–3 "doubt prompts" the residents will see
// above the Ask & Vote compose box. Returns the drafts — persists nothing.
// The speaker accepts/dismisses each, and acceptance is via the existing
// PATCH /prep endpoint that already saves to session.metadata.doubtPrompts.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  suggestDoubtPromptsForSession,
  SuggestPromptsError,
} from '@/server/services/pre-questions/suggest-prompts-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

function statusFor(code: SuggestPromptsError['code']): number {
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
    bucket: `prompts-suggest:${auth.user.id}`,
    ...LIMITS.DOCUMENT_ANALYZE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Prompt suggestion throttled', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await suggestDoubtPromptsForSession({
      sessionId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PRE_QUESTION_PROMPTS_SUGGESTED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: `AI suggested ${result.suggestions.length} doubt prompt${result.suggestions.length === 1 ? '' : 's'}`,
      details: { count: result.suggestions.length },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof SuggestPromptsError) {
      const details = err.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: err.retryAfterSeconds }
        : undefined;
      return jsonError(err.code, err.message, statusFor(err.code), details);
    }
    return handleUnexpected(err);
  }
}

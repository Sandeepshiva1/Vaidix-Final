// ════════════════════════════════════════════════════════════════════════════
// POST /api/decks/[jobId]/suggest-hooks — slide-grounded AI hook drafts
// ════════════════════════════════════════════════════════════════════════════
// Body: { slideId }. Gemini drafts up to 3 live-session hooks anchored to that
// slide. Returns DRAFTS only — the deck Hooks tab reviews/edits, then creates
// each via the existing POST /api/classroom/sessions/[id]/hooks endpoint.
// Auth mirrors /api/decks/[jobId]/analyze (faculty-like + deck ownership).

import { Role } from '@prisma/client';
import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  suggestDeckHooks,
  SuggestDeckHooksError,
} from '@/server/services/decks/suggest-deck-hooks-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const bodySchema = z.object({ slideId: z.string().min(1) });

function statusFor(code: SuggestDeckHooksError['code']): number {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'FORBIDDEN': return 403;
    case 'NO_CONTEXT': return 422;
    case 'AI_UNAVAILABLE': return 503;
    default: return 400;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Billable upstream (Gemini) — throttle per user. Reuse the deck-analyze bucket
  // shape; this is a lighter single-call request.
  const rl = await checkRateLimit({ bucket: `deck-suggest-hooks:${auth.user.id}`, ...LIMITS.DECK_ANALYZE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Hook suggestions throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await suggestDeckHooks({
      jobId,
      slideId: body.data.slideId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof SuggestDeckHooksError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

// POST /api/classroom/sessions/[id]/hooks/[hookId]/respond
// Learner submits their answer to a fired hook. Records hook response +
// emits a HOOK_RESPONSE engagement signal.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { recordHookResponse } from '@/server/services/hooks/hooks-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const respondSchema = z.object({
  response: z.string().min(1).max(500),
  latencyMs: z.number().int().nonnegative().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; hookId: string }> }
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, respondSchema);
  if (!body.ok) return body.response;
  const { hookId } = await ctx.params;

  const rl = await checkRateLimit({ bucket: `hook-respond:${auth.user.id}`, ...LIMITS.HOOK_RESPOND });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Too many responses — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await recordHookResponse({
      hookId,
      userId: auth.user.id,
      response: body.data.response,
      latencyMs: body.data.latencyMs,
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_RESPONDED,
      entityType: 'LiveHookResponse',
      entityId: hookId,
      summary: `Response submitted; correct=${result.isCorrect ?? 'n/a'}`,
      details: { hookId, isCorrect: result.isCorrect },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result);
  } catch (err) {
    // Map service-layer Error messages to specific status codes so the
    // resident UI can give actionable feedback instead of a generic 500.
    if (err instanceof Error) {
      const m = err.message;
      if (/not found/i.test(m)) return jsonError('NOT_FOUND', m, 404);
      // Closed = was open, now isn't (e.g. host closed it mid-session).
      // Conflict is the right semantic here.
      if (/closed/i.test(m)) return jsonError('CONFLICT', m, 409);
      // Hook never opened (no firedAt, no prePublishedAt) — the resident UI
      // never should have shown this row. Treat as a stale-state conflict.
      if (/not yet open/i.test(m)) return jsonError('NOT_OPEN', m, 409);
      // Submitted option is not in the declared set — a validation issue
      // that the route schema can't catch (it doesn't know the hook's
      // options). 400 is the right code.
      if (/offered options|one of the/i.test(m)) {
        return jsonError('VALIDATION', m, 400);
      }
    }
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/captions/translate
// ════════════════════════════════════════════════════════════════════════════
// Per-listener live caption translation. The overlay calls this when the
// listener's chosen language differs from the broadcast lang. Gemini Flash
// behind a Redis cache so 50 listeners pay for ~1 translation per segment.
//
// Auth: any authenticated user with effective access to the session
// (HOST/CO_HOST/PARTICIPANT/VIEWER) — no role escalation, just
// "you can see the session, you can translate its captions for yourself."

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import { translateCaption, SUPPORTED_LANGS, TranslateError } from '@/server/services/captions/translate-service';

const translateSchema = z.object({
  // Live caption segments are short; a tight cap reduces per-call cost and the
  // value of forcing cache misses with long attacker-supplied text.
  text: z.string().min(1).max(1000),
  from: z.enum(SUPPORTED_LANGS),
  to: z.enum(SUPPORTED_LANGS),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;

  // Any role that can see the session can translate captions for themselves.
  // `getEffectiveSessionRole` returns null when invisible.
  const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
  if (!role) {
    return jsonError('FORBIDDEN', 'You do not have access to this session', 403);
  }

  const parsed = await parseBody(req, translateSchema);
  if (!parsed.ok) return parsed.response;

  const meta = extractRequestMetadata(req);
  // Per-user, per-session, and per-IP ceilings — all fail-closed. The session
  // and IP buckets bound the cost even when an attacker spreads requests across
  // many accounts (the cache key is the attacker-controlled text).
  const limits = [
    { bucket: `captions-translate:${auth.user.id}`, ...LIMITS.CAPTIONS_TRANSLATE },
    { bucket: `captions-translate-session:${sessionId}`, ...LIMITS.CAPTIONS_TRANSLATE_SESSION },
    { bucket: `captions-translate-ip:${meta.ipAddress ?? 'noip'}`, ...LIMITS.CAPTIONS_TRANSLATE_IP },
  ];
  for (const cfg of limits) {
    const rl = await checkRateLimit(cfg);
    if (!rl.allowed) {
      return jsonError(
        'RATE_LIMITED',
        'Translation rate exceeded — try again later',
        429,
        { resetAt: rl.resetAt.toISOString() },
      );
    }
  }

  try {
    const result = await translateCaption({
      text: parsed.data.text,
      from: parsed.data.from,
      to: parsed.data.to,
    });

    // Audit only on cache miss — cache hits are free and noisy.
    if (!result.cached) {
      await audit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        eventType: AUDIT_EVENTS.CAPTIONS_TRANSLATED,
        entityType: 'TeachingSession',
        entityId: sessionId,
        summary: `Caption translated ${parsed.data.from}→${parsed.data.to}`,
        details: { from: parsed.data.from, to: parsed.data.to, textLength: parsed.data.text.length },
        ...extractRequestMetadata(req),
      });
    }

    return jsonOk({ translated: result.translated, cached: result.cached });
  } catch (err) {
    if (err instanceof TranslateError) {
      const status = err.code === 'AI_UNAVAILABLE' ? 503 : 502;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

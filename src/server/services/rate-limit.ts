// ════════════════════════════════════════════════════════════════════════════
// Rate Limiting — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Uses Redis for sliding-window rate limits.
// Buckets: login:<email>, forgot:<ip>, accept-invite:<ip>, api:<userId>.
//
// Two failure modes (set per-bucket via LIMITS):
//   - 'open'   → if Redis is down, allow the request and flag `degraded: true`.
//                Best for high-volume, low-risk paths (engagement signals,
//                read APIs) where blocking everyone hurts the user more than
//                the abuse window does.
//   - 'closed' → if Redis is down, REFUSE the request (allowed: false).
//                Mandatory for credential and outbound-cost paths (login,
//                password reset, invitation send, WhatsApp, coach calls)
//                where unbounded retries are a security/cost incident.
//
// security hardening.

import { redis } from '@/lib/redis';

export type RateLimitFailMode = 'open' | 'closed';

export interface RateLimitConfig {
  bucket: string;
  limit: number;
  windowSec: number;
  /** What happens if Redis is unreachable. Defaults to 'open' for back-compat. */
  failMode?: RateLimitFailMode;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  /** True when Redis was unreachable for this check. */
  degraded?: boolean;
  /** Why the request was denied while degraded — for the UI / logs. */
  reason?: 'limit' | 'redis_down_fail_closed';
}

const REDIS_OP_TIMEOUT_MS = 750;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rate-limit redis timeout')), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  const key = `rl:${config.bucket}`;
  const failMode: RateLimitFailMode = config.failMode ?? 'open';
  try {
    const count = await withTimeout(redis.incr(key), REDIS_OP_TIMEOUT_MS);
    if (count === 1) {
      // expire is fire-and-forget — if it fails the next incr resets it
      withTimeout(redis.expire(key, config.windowSec), REDIS_OP_TIMEOUT_MS).catch(() => {});
    }
    const ttl = await withTimeout(redis.ttl(key), REDIS_OP_TIMEOUT_MS);
    const resetAt = new Date(Date.now() + (ttl > 0 ? ttl * 1000 : config.windowSec * 1000));

    return {
      allowed: count <= config.limit,
      remaining: Math.max(0, config.limit - count),
      resetAt,
      reason: count <= config.limit ? undefined : 'limit',
    };
  } catch (err) {
    const msg = (err as Error).message;
    if (failMode === 'closed') {
      // Sensitive bucket — refuse rather than allow unbounded retries.
      console.error(
        `[rate-limit] redis unavailable, FAIL-CLOSED for bucket=${config.bucket}: ${msg}`
      );
      return {
        allowed: false,
        remaining: 0,
        // Short retry window — operator should be reviving Redis quickly.
        resetAt: new Date(Date.now() + 5_000),
        degraded: true,
        reason: 'redis_down_fail_closed',
      };
    }
    // Redis unreachable — fail open with a clear log line so SREs notice.
    console.warn(
      `[rate-limit] redis unavailable, failing open for bucket=${config.bucket}: ${msg}`
    );
    return {
      allowed: true,
      remaining: config.limit,
      resetAt: new Date(Date.now() + config.windowSec * 1000),
      degraded: true,
    };
  }
}

// Sensitive buckets MUST set failMode: 'closed'. Anything that issues
// credentials, sends mail/SMS/WhatsApp, or calls a billable upstream goes here.
export const LIMITS = {
  // ─── Auth / identity (fail-closed: protects against credential attacks) ──
  LOGIN: { limit: 5, windowSec: 15 * 60, failMode: 'closed' as const },
  FORGOT_PASSWORD: { limit: 3, windowSec: 60 * 60, failMode: 'closed' as const },
  ACCEPT_INVITE: { limit: 10, windowSec: 15 * 60, failMode: 'closed' as const },
  INVITATION_CREATE: { limit: 30, windowSec: 60 * 60, failMode: 'closed' as const },
  // Bulk invite import (admin uploads .xlsx). 1 unit = 1 batch (NOT 1 row).
  // Batch size is capped at 500 rows server-side, so 5 batches/hour caps the
  // mail/audit fan-out at 2,500/hour per admin. Fail-closed because each row
  // sends an email and writes audit rows — runaway retries on a Redis outage
  // would burn outbound mail quota.
  BULK_INVITATION_CREATE: { limit: 5, windowSec: 60 * 60, failMode: 'closed' as const },

  // General API — fail-open (read-heavy, low-risk).
  API_GENERAL: { limit: 300, windowSec: 60, failMode: 'open' as const },

  // ─── ───────────────────────────────────────────────────────────
  DOCUMENT_UPLOAD: { limit: 30, windowSec: 60 * 60, failMode: 'open' as const },
  DOCUMENT_ANALYZE: { limit: 60, windowSec: 60 * 60, failMode: 'closed' as const }, // billable upstream
  // Legacy single-source forge (document-detail "Forge presentation" button).
  // 1 Gemini call per forge. Was previously referenced but missing — fixed.
  DECK_FORGE: { limit: 30, windowSec: 60 * 60, failMode: 'closed' as const },
  // Wizard forge runs Gemini-extract + Opus-draft in series (~2x cost +
  // multimodal blob ingest). Tighter ceiling than legacy.
  DECK_WIZARD_FORGE: { limit: 15, windowSec: 60 * 60, failMode: 'closed' as const },
  // Deck analyze runs both Opus (review) and Sonnet (design) — twice as
  // expensive as DOCUMENT_ANALYZE. Tighter ceiling.
  DECK_ANALYZE: { limit: 30, windowSec: 60 * 60, failMode: 'closed' as const },
  // Per-slide AI refine (faculty asks "tighten this" / "add evidence" via
  // chat). Each call is a single Opus or Gemini hit.
  DECK_REFINE: { limit: 120, windowSec: 60 * 60, failMode: 'closed' as const },
  // Case-forge — heavy multimodal Gemini call. Tighter ceiling than deck-
  // forge (cases are typically forged less often than decks per document).
  CASE_FORGE: { limit: 20, windowSec: 60 * 60, failMode: 'closed' as const },
  HOOK_CREATE: { limit: 60, windowSec: 60 * 60, failMode: 'open' as const },
  HOOK_RESPOND: { limit: 200, windowSec: 60 * 60, failMode: 'open' as const },
  WHATSAPP_SEND: { limit: 100, windowSec: 60 * 60, failMode: 'closed' as const }, // billable + abuse vector
  WHATSAPP_SCHEDULE: { limit: 30, windowSec: 60 * 60, failMode: 'closed' as const },
  COACH_ASK: { limit: 60, windowSec: 60 * 60, failMode: 'closed' as const }, // billable Gemini call
  KIRKPATRICK_WRITE: { limit: 60, windowSec: 60 * 60, failMode: 'open' as const },
  ENGAGEMENT_SIGNAL_WRITE: { limit: 600, windowSec: 60, failMode: 'open' as const },

  // ─── — Live collaboration ─────────────────────────────────────────────
  // Reactions burst hard during exciting moments — keep ceiling generous.
  // Fail-open because each event also rides the LiveKit data channel; losing
  // a DB row degrades replay accuracy but doesn't break the live UX.
  SESSION_EVENT_WRITE: { limit: 600, windowSec: 60, failMode: 'open' as const },
  SHARED_NOTE_WRITE: { limit: 120, windowSec: 60, failMode: 'open' as const },
  SESSION_FILE_UPLOAD: { limit: 30, windowSec: 60 * 60, failMode: 'closed' as const },
  WEBINAR_REGISTER: { limit: 5, windowSec: 60 * 60, failMode: 'closed' as const },

  // ─── — Live captions ────────────────────────────────────────────────
  // Token mint: one mint per session is the steady state, but reconnects on
  // network blips can burst. Fail-closed: short-lived Deepgram tokens are
  // billable upstream and a leak vector if uncapped.
  CAPTIONS_TOKEN_MINT: { limit: 60, windowSec: 60 * 60, failMode: 'closed' as const },
  // Publish: one POST per finalized Deepgram segment. ~3-5/sec during active
  // speech is normal; cap at ~600/min/session = ~10/sec headroom. Fail-open
  // because a dropped segment merely degrades the live overlay; users still
  // see the audio, the post-recording transcript fills the gap.
  CAPTIONS_PUBLISH: { limit: 600, windowSec: 60, failMode: 'open' as const },
  // Translate: per-listener Gemini fan-out is the worst case. Fail-closed
  // because Gemini is billable and a runaway re-render loop on the overlay
  // shouldn't silently rack up cost.
  CAPTIONS_TRANSLATE: { limit: 300, windowSec: 60 * 60, failMode: 'closed' as const },
  // Defense-in-depth on top of the per-user cap: an attacker controlling many
  // accounts can still drive billable Gemini calls because the cache key is the
  // (attacker-controlled) text. A per-session and per-IP ceiling bounds the
  // blast radius regardless of how many accounts are used.
  CAPTIONS_TRANSLATE_SESSION: { limit: 3000, windowSec: 60 * 60, failMode: 'closed' as const },
  CAPTIONS_TRANSLATE_IP: { limit: 600, windowSec: 60 * 60, failMode: 'closed' as const },

  // Standalone learning-engine AI endpoints. grade / report-coach (Gemini) and
  // voice (Sarvam STT) are billable upstream calls driven by fully user-supplied
  // bodies. Fail-closed: an unbounded retry loop on a Redis outage is a cost/
  // abuse incident, not just degraded UX.
  GRADE: { limit: 120, windowSec: 60 * 60, failMode: 'closed' as const },
  REPORT_COACH: { limit: 30, windowSec: 60 * 60, failMode: 'closed' as const },
  VOICE_STT: { limit: 120, windowSec: 60 * 60, failMode: 'closed' as const },

  // Public recording-share password attempts. Without this an attacker with a
  // valid (256-bit) share link can brute-force a weak password unthrottled.
  // Keyed per token+IP, fail-closed.
  SHARE_PASSWORD: { limit: 10, windowSec: 15 * 60, failMode: 'closed' as const },
} as const;

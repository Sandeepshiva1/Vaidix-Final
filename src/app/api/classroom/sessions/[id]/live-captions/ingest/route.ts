// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/live-captions/ingest
// ════════════════════════════════════════════════════════════════════════════
// Single write path for live captions. Consumed by the LiveKit Agent
// (Python sidecar, runs hidden in every LIVE room — see vaidix-agent/). Auth
// is a shared bearer secret (LIVE_CAPTIONS_INGEST_SECRET) because the agent
// runs out-of-process with no Vaidix session cookie.
//
// Pipeline (mirrors the old browser-side /captions/publish, now deleted):
//   1. Drop segments if session.status !== LIVE (silently — agent stays
//      attached during pre-flight + post-end and we don't want to flap it
//      with 4xx retries).
//   2. Broadcast every segment (partials + finals) to Redis pub/sub channel
//      `caption:<sessionId>` — the existing SSE GET fans this out to every
//      viewer who has CC=ON, regardless of which participant is speaking.
//   3. Persist finals only (partials would thrash the DB row) via the same
//      transcript-service.appendSegment used everywhere else, so PDF export
//      + Bloom's analytics + the AI hook generator all keep working
//      unchanged.
//   4. On the first persisted segment of a session, arm the 15-min auto-hook
//      timer. Same trigger the old /publish route used.
//   5. `finalizeOnEnd` (segments=[] OR segments=[…] + flag set) locks every
//      open SessionTranscript row for the session and enqueues the
//      post-session content pack job.

import { z } from 'zod';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { SessionStatus } from '@prisma/client';
import { redis } from '@/lib/redis';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { liveCaptionChannel, type LiveCaptionSegment } from '@/server/services/captions/captions-pubsub';
import { appendSegment, finalizeTranscript } from '@/server/services/captions/transcript-service';
import { scheduleFirstHookRound } from '@/server/services/captions/hook-generator-service';
import { getQueue, QUEUES } from '@/lib/queue';

const SUPPORTED_LANGS = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn', 'ur'] as const;

const segmentSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string().min(1).max(5000),
  lang: z.enum(SUPPORTED_LANGS),
  // Display name of the speaker, as the agent saw it on the LiveKit
  // participant. Render-time only — persistence stores it as `speakerName`.
  speaker: z.string().max(120).optional(),
  // LiveKit identity of the speaker (user.id for authed participants,
  // `guest_<admissionId>` for anonymous guests). Optional today — used only
  // when we later want to backfill `speakerId` for cohort analytics.
  speakerIdentity: z.string().max(120).optional(),
  partial: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const ingestSchema = z
  .object({
    segments: z.array(segmentSchema).max(50).default([]),
    finalizeOnEnd: z.boolean().optional(),
  })
  .refine((v) => v.segments.length > 0 || v.finalizeOnEnd === true, {
    message: 'segments must be non-empty unless finalizeOnEnd is true',
    path: ['segments'],
  });

function isAuthorized(req: Request): boolean {
  if (!env.LIVE_CAPTIONS_INGEST_SECRET) return false;
  const header = req.headers.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return !!m && m[1] === env.LIVE_CAPTIONS_INGEST_SECRET;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) {
    return jsonError('UNAUTHORIZED', 'Invalid or missing ingest secret', 401);
  }

  const parsed = await parseBody(req, ingestSchema);
  if (!parsed.ok) return parsed.response;

  const { id: sessionId } = await ctx.params;

  // Per-session token-bucket. Agent under healthy load posts ~3-5 segments/s;
  // 600/min/session is plenty. Fail-open so a brief overflow degrades the
  // live overlay only, never blocks audio.
  const rl = await checkRateLimit({
    bucket: `captions-ingest:${sessionId}`,
    ...LIMITS.CAPTIONS_PUBLISH,
  });
  if (!rl.allowed) {
    return jsonError(
      'RATE_LIMITED',
      'Caption ingest rate exceeded',
      429,
      { resetAt: rl.resetAt.toISOString() },
    );
  }

  try {
    const session = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    // Pre-flight + ENDED sessions: accept-and-discard so the agent's retry
    // loop stays quiet, but don't broadcast and don't persist.
    if (!session || session.status !== SessionStatus.LIVE) {
      return jsonOk({
        published: 0,
        persisted: 0,
        dropped: parsed.data.segments.length,
        reason: 'NOT_LIVE',
      });
    }

    const channel = liveCaptionChannel(sessionId);
    let publishedCount = 0;
    let persistedCount = 0;
    let firstPersistedSeen = false;

    for (const seg of parsed.data.segments) {
      const wirePayload: LiveCaptionSegment = {
        sessionId,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text,
        lang: seg.lang,
        speaker: seg.speaker,
        partial: seg.partial ?? false,
      };
      await redis.publish(channel, JSON.stringify(wirePayload));
      publishedCount++;

      // Finals only get durable storage. Partials would re-write the row 5x/s.
      if (!seg.partial) {
        const result = await appendSegment({
          sessionId,
          language: seg.lang,
          source: 'deepgram',
          segment: {
            startMs: seg.startMs,
            endMs: seg.endMs,
            text: seg.text,
            // No reliable speakerId lookup from the agent context — the
            // identity it sends could be a guest_* CUID that isn't in
            // User.id space. Leave null; PDF + insights use speakerName.
            speakerId: null,
            speakerName: seg.speaker?.trim() || null,
            confidence: seg.confidence ?? null,
          },
        });
        if (!result.capped) {
          persistedCount++;
          // Arm the 15-min auto-hook timer on the very first persisted
          // segment for this session. scheduleFirstHookRound is idempotent
          // via jobId, so racing agents (e.g. quick reconnect) is safe.
          if (result.created && !firstPersistedSeen) {
            firstPersistedSeen = true;
            scheduleFirstHookRound(sessionId).catch(() => {});
          }
        }
      }
    }

    if (parsed.data.finalizeOnEnd) {
      const segLangs = new Set(parsed.data.segments.filter((s) => !s.partial).map((s) => s.lang));
      const langsToFinalize: string[] = [];
      if (segLangs.size > 0) {
        langsToFinalize.push(...segLangs);
      } else {
        const open = await db.sessionTranscript.findMany({
          where: { sessionId, finalized: false },
          select: { language: true },
        });
        langsToFinalize.push(...open.map((r) => r.language));
      }
      for (const lang of langsToFinalize) {
        await finalizeTranscript({ sessionId, language: lang });
      }
      getQueue(QUEUES.POST_SESSION)
        .add('post-session-pack', { sessionId }, {
          jobId: `psp-auto-${sessionId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        })
        .catch(() => {});
      await audit({
        actorId: null,
        actorRole: null,
        eventType: AUDIT_EVENTS.CAPTIONS_TRANSCRIPT_FINALIZED,
        entityType: 'TeachingSession',
        entityId: sessionId,
        summary: 'Live captions finalized (agent end-of-stream)',
        details: { languages: langsToFinalize, source: 'agent' },
        ...extractRequestMetadata(req),
      });
    }

    await audit({
      actorId: null,
      actorRole: null,
      eventType: AUDIT_EVENTS.CAPTIONS_PUBLISHED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: `Agent batch (${publishedCount} broadcast, ${persistedCount} persisted)`,
      details: { publishedCount, persistedCount, finalizeOnEnd: parsed.data.finalizeOnEnd ?? false, source: 'agent' },
      ...extractRequestMetadata(req),
    });

    return jsonOk({ published: publishedCount, persisted: persistedCount });
  } catch (err) {
    return handleUnexpected(err);
  }
}

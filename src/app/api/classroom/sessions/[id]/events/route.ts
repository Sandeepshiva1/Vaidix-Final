// POST /api/classroom/sessions/[id]/events
//   Persists a replay-able session event (reaction, spotlight, blur toggle,
//   etc.) into SessionAuditEvent. The live propagation rides the LiveKit
//   data channel; this endpoint is the durable persistence layer that the
//   recording-viewer reads to replay overlays in sync with the video.
//
// GET /api/classroom/sessions/[id]/events
//   Lists replay events. Supports `since` (ISO date — incremental fetch for
//   late joiners) and `tMsFrom`/`tMsTo` (recording-viewer windowing).
//   Lifecycle/moderation events are excluded — only types in
//   REPLAYABLE_EVENT_TYPES are returned.
//
// This route deliberately reuses SessionAuditEvent rather than creating a
// parallel events table. See VAIDIX-BUILD-PLAN-NOW.md §W7 for the rationale.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import {
  computeTMs,
  HOST_ONLY_EVENT_TYPES,
  REPLAYABLE_EVENT_TYPES,
  SESSION_AUDIT,
  sessionAudit,
} from '@/server/services/session-audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const REPLAYABLE_LIST = Array.from(REPLAYABLE_EVENT_TYPES);

const writeSchema = z.object({
  // Constrained to replayable types — lifecycle events are server-only.
  eventType: z.enum(REPLAYABLE_LIST as [string, ...string[]]),
  targetUserId: z.string().cuid().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const body = await parseBody(req, writeSchema);
    if (!body.ok) return body.response;
    const { id: sessionId } = await ctx.params;

    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    // Host-only event gate.
    if (
      HOST_ONLY_EVENT_TYPES.has(body.data.eventType as never) &&
      role !== 'HOST' &&
      role !== 'CO_HOST'
    ) {
      return jsonError('FORBIDDEN', 'Only the host can spotlight participants', 403);
    }

    // SPOTLIGHT_SET requires a target.
    if (body.data.eventType === SESSION_AUDIT.SPOTLIGHT_SET && !body.data.targetUserId) {
      return jsonError('VALIDATION_ERROR', 'SPOTLIGHT_SET requires targetUserId', 422);
    }

    const rl = await checkRateLimit({
      bucket: `session-event:${auth.user.id}`,
      ...LIMITS.SESSION_EVENT_WRITE,
    });
    if (!rl.allowed) {
      return jsonError('RATE_LIMITED', 'Event write rate exceeded', 429, {
        resetAt: rl.resetAt.toISOString(),
      });
    }

    const tMs = await computeTMs(sessionId);
    await sessionAudit({
      sessionId,
      eventType: body.data.eventType as never,
      actorId: auth.user.id,
      targetUserId: body.data.targetUserId ?? null,
      details: body.data.details ?? null,
      tMs,
    });
    return jsonOk({ recorded: true, tMs }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

const listQuerySchema = z.object({
  since: z.string().datetime().optional(),
  tMsFrom: z.coerce.number().int().optional(),
  tMsTo: z.coerce.number().int().optional(),
  kinds: z.string().optional(), // CSV
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const { id: sessionId } = await ctx.params;
    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonError('INVALID_QUERY', 'Bad query', 422, parsed.error.flatten().fieldErrors);
    }
    const q = parsed.data;
    const requestedKinds = q.kinds
      ? q.kinds.split(',').map((s) => s.trim()).filter((k) => REPLAYABLE_EVENT_TYPES.has(k as never))
      : REPLAYABLE_LIST;

    const events = await db.sessionAuditEvent.findMany({
      where: {
        sessionId,
        eventType: { in: requestedKinds },
        ...(q.since ? { createdAt: { gt: new Date(q.since) } } : {}),
        ...(q.tMsFrom != null || q.tMsTo != null
          ? {
              tMs: {
                ...(q.tMsFrom != null ? { gte: q.tMsFrom } : {}),
                ...(q.tMsTo != null ? { lte: q.tMsTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ tMs: 'asc' }, { createdAt: 'asc' }],
      take: q.limit,
      select: {
        id: true,
        eventType: true,
        actorId: true,
        targetUserId: true,
        details: true,
        tMs: true,
        createdAt: true,
      },
    });
    return jsonOk({ events });
  } catch (err) {
    return handleUnexpected(err);
  }
}

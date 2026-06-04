// /api/classroom/sessions/[id]/reels — Stream A8
// POST: create a reel (start/end seconds within the recording).
// GET: list reels for this session visible to the actor.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { createReel, listReels, ReelAccessError } from '@/server/services/clips/reels-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const createSchema = z.object({
  startSec: z.number().int().min(0),
  endSec: z.number().int().min(1),
  title: z.string().max(120).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;

  // Reuse the document-analyze rate-limit budget — render is similarly expensive.
  const rl = await checkRateLimit({ bucket: `reel:${auth.user.id}`, ...LIMITS.DOCUMENT_ANALYZE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Too many reel renders — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await createReel({
      sessionId,
      startSec: body.data.startSec,
      endSec: body.data.endSec,
      title: body.data.title,
      createdBy: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.RECORDING_TRANSCODE_DONE, // closest existing event for clip render
      entityType: 'Clip',
      entityId: result.clipId,
      summary: `Reel render queued (${body.data.startSec}s–${body.data.endSec}s)`,
      details: { sessionId, startSec: body.data.startSec, endSec: body.data.endSec },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof ReelAccessError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  try {
    const reels = await listReels(sessionId, { userId: auth.user.id, role: auth.user.role });
    return jsonOk({ reels });
  } catch (err) {
    return handleUnexpected(err);
  }
}

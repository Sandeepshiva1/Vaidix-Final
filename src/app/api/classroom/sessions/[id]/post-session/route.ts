// ════════════════════════════════════════════════════════════════════════════
// GET  /api/classroom/sessions/[id]/post-session  — read content pack
// POST /api/classroom/sessions/[id]/post-session  — manually trigger generation
// ════════════════════════════════════════════════════════════════════════════
// GET:  any session-visible role can read the generated pearls/QA/SJT/PBL.
// POST: host, PD, or admin can manually re-trigger generation (e.g. if the
//       auto-trigger on finalize failed or ANTHROPIC_API_KEY was added late).

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import { getQueue, QUEUES } from '@/lib/queue';
import { readPostSessionPack } from '@/server/services/captions/post-session-pack-service';
import { Role } from '@prisma/client';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;
  const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
  if (!role) return jsonError('FORBIDDEN', 'You do not have access to this session', 403);

  try {
    const pack = await readPostSessionPack(sessionId);
    if (!pack) return jsonError('NOT_FOUND', 'No transcript found for this session', 404);
    return jsonOk(pack);
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;
  const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
  if (!role) return jsonError('FORBIDDEN', 'You do not have access to this session', 403);

  // Only host, PD, or admin can trigger generation.
  const canTrigger =
    role === 'HOST' ||
    role === 'CO_HOST' ||
    auth.user.role === Role.PROGRAM_DIRECTOR ||
    auth.user.role === Role.ADMIN;
  if (!canTrigger) return jsonError('FORBIDDEN', 'Only the host or admin can trigger content generation', 403);

  try {
    const job = await getQueue(QUEUES.POST_SESSION).add(
      'post-session-pack',
      { sessionId },
      {
        jobId: `psp-manual-${sessionId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.POST_SESSION_PACK_TRIGGERED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: 'Post-session content pack manually triggered',
      ...extractRequestMetadata(req),
    });

    return jsonOk({ jobId: job.id, queued: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

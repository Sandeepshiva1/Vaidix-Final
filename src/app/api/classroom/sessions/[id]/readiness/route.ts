// ════════════════════════════════════════════════════════════════════════════
// GET /api/classroom/sessions/[id]/readiness
// ════════════════════════════════════════════════════════════════════════════
// Returns the per-learner readiness snapshot for the session host / PD / admin.
// Residents calling this get 403 — readiness reveals individual identity which
// only the presenter side should see.
//
// Read-only deterministic computation; no rate-limit needed beyond the global
// API_GENERAL bucket (a misbehaving client polling every second would still
// only push 60 rps which the DB handles trivially).

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  computeSessionReadiness,
  ReadinessAccessError,
} from '@/server/services/readiness/readiness-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';

function statusFor(code: string): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  try {
    const snapshot = await computeSessionReadiness(
      { userId: auth.user.id, role: auth.user.role },
      sessionId
    );
    // Audit reads — readiness exposes per-learner identity, so PD/admin
    // access is loggable for compliance review (mirrors the audit
    // pattern around DOPS-style assessment views).
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.READINESS_VIEWED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: `Readiness snapshot viewed`,
      details: {
        sessionId,
        learners: snapshot.cohortStats.totalLearners,
        averageScore: snapshot.cohortStats.averageScore,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk(snapshot);
  } catch (err) {
    if (err instanceof ReadinessAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

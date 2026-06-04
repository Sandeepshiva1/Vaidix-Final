// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/pre-cases/[preCaseId]/start
// ════════════════════════════════════════════════════════════════════════════
// Resident clicks "Start" on a Study Pack pre-case. Idempotent:
//   - if the resident already has an ACTIVE Case for this template, return it
//   - else create a fresh Case via the cases-service path
// Returns { caseId, conversationId } so the client can navigate to
// /cases/[caseId] (the existing Socratic conversation surface).

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  startPreCaseAttempt,
  PreCaseAccessError,
} from '@/server/services/study-pack/pre-case-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';
import { recordEngagementSignal } from '@/server/services/engagement/engagement-service';
import { EngagementSignalKind } from '@prisma/client';

function statusFor(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'CONFLICT') return 409;
  return 400;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string; preCaseId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId, preCaseId } = await ctx.params;
  try {
    const result = await startPreCaseAttempt({
      sessionId,
      preCaseId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    // First-time start emits an engagement signal so readiness rises immediately.
    // Re-entries (`reused: true`) don't fire — avoids signal spam from refresh clicks.
    if (!result.reused) {
      await recordEngagementSignal({
        sessionId,
        userId: auth.user.id,
        kind: EngagementSignalKind.PRE_CASE_STARTED,
        metadata: { preCaseId, caseId: result.caseId },
      });
    }
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PRE_CASE_STARTED,
      entityType: 'Case',
      entityId: result.caseId,
      summary: result.reused ? `Pre-case attempt resumed` : `Pre-case attempt started`,
      details: { sessionId, preCaseId, caseId: result.caseId, reused: result.reused },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: result.reused ? 200 : 201 });
  } catch (err) {
    if (err instanceof PreCaseAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

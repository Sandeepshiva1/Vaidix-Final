// ════════════════════════════════════════════════════════════════════════════
// GET/POST /api/classroom/sessions
// ════════════════════════════════════════════════════════════════════════════

import { jsonOk, jsonError, parseBody, requireAuthWithProgram, handleUnexpected } from '@/server/services/api-helpers';
import { createSession } from '@/server/services/session-service';
import { createSessionSchema } from '@/lib/validation/session';
import { db } from '@/lib/db';
import { Role, SessionApprovalStatus } from '@prisma/client';

export async function GET(req: Request) {
  try {
    // W6.11 — sessions are program-scoped.
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const { user } = gate;

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const hostOnly = url.searchParams.get('hostOnly') === 'true';

    const sessions = await db.teachingSession.findMany({
      where: {
        programId: user.activeProgramId,
        deletedAt: null,
        approvalStatus: status ? (status as SessionApprovalStatus) : undefined,
        hostId: hostOnly ? user.id : undefined,
      },
      include: {
        host: { select: { id: true, name: true, email: true } },
        proposer: { select: { id: true, name: true } },
        cohort: { select: { id: true, name: true } },
        _count: { select: { participants: true, invites: true } },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 100,
    });

    return jsonOk({ sessions });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const { user } = gate;

    if (
      user.role !== Role.PROGRAM_DIRECTOR &&
      user.role !== Role.ADMIN &&
      user.role !== Role.FACULTY &&
      user.role !== Role.RESIDENT
    ) {
      return jsonError('FORBIDDEN', 'Only Faculty, PDs, Admins, and Residents can schedule sessions', 403);
    }

    const body = await parseBody(req, createSessionSchema);
    if (!body.ok) return body.response;

    const { session, hostConflicts } = await createSession(body.data, user.id, user.role, user.activeProgramId);
    // Overlapping host calendars are non-blocking (Teams parity). The client
    // surfaces hostConflicts as a soft warning after creation succeeds.
    return jsonOk({ session, warnings: { hostConflicts } }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'HOST_NOT_FOUND') return jsonError('HOST_NOT_FOUND', 'Host user not found or inactive', 404);
    if (msg === 'HOST_NOT_FACULTY') return jsonError('HOST_NOT_FACULTY', 'Host must be Faculty, PD, Admin, or yourself (residents can host their own peer sessions)', 400);
    if (msg === 'COHORT_NOT_FOUND') return jsonError('COHORT_NOT_FOUND', 'Cohort not found', 404);
    if (msg === 'COHORT_PROGRAM_MISMATCH') return jsonError('COHORT_PROGRAM_MISMATCH', 'Cohort belongs to a different program', 400);
    if (msg === 'FORBIDDEN_PROPOSER_ROLE') return jsonError('FORBIDDEN', 'Role cannot propose sessions', 403);
    return handleUnexpected(err);
  }
}

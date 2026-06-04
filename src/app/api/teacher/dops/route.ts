// ════════════════════════════════════════════════════════════════════════════
// POST /api/teacher/dops — record a DOPS (Direct Observation of Procedural
// Skills) assessment for a resident. Writes to the real `dops_assessments`
// table. Gated to FACULTY / PROGRAM_DIRECTOR / ADMIN; the resident must be a
// real, active RESIDENT.
// ════════════════════════════════════════════════════════════════════════════

import { Role, AssessmentOutcome } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  requireRole,
  parseBody,
  jsonOk,
  jsonError,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { audit } from '@/server/services/audit';

const schema = z.object({
  residentId: z.string().min(1),
  procedureName: z.string().min(1).max(200),
  performedAt: z.string().min(1), // YYYY-MM-DD
  domainScores: z.record(z.string(), z.number().int().min(1).max(9)),
  overallRating: z.number().int().min(1).max(9),
  feedback: z.string().max(4000).optional(),
  location: z.string().max(200).optional(),
});

// Overall 1-9 → competency outcome (mirrors the medical-education DOPS rubric:
// 1-3 below expectations, 4-6 borderline, 7-9 competent).
function outcomeFor(rating: number): AssessmentOutcome {
  if (rating <= 3) return AssessmentOutcome.NOT_YET_COMPETENT;
  if (rating <= 6) return AssessmentOutcome.BORDERLINE;
  return AssessmentOutcome.PASSED;
}

export async function POST(req: Request) {
  const gate = await requireRole(Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN);
  if (!gate.ok) return gate.response;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { residentId, procedureName, performedAt, domainScores, overallRating, feedback, location } =
    body.data;

  // The assessment target must be a real, active resident.
  const resident = await db.user.findUnique({
    where: { id: residentId },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!resident || resident.deletedAt || resident.role !== Role.RESIDENT) {
    return jsonError('NOT_FOUND', 'Resident not found', 404);
  }

  const performed = new Date(performedAt);
  if (Number.isNaN(performed.getTime())) {
    return jsonError('VALIDATION_ERROR', 'Invalid assessment date', 422);
  }

  try {
    const record = await db.dopsAssessment.create({
      data: {
        residentId,
        assessorId: gate.user.id,
        procedureName,
        outcome: outcomeFor(overallRating),
        location: location ?? null,
        comments: feedback ?? null,
        // Per-domain scores + the raw overall are preserved in `artifacts` so
        // nothing is lost vs. the dedicated columns the rubric doesn't have.
        artifacts: { domainScores, overallRating },
        performedAt: performed,
      },
      select: { id: true },
    });

    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: 'assessment.dops.created',
      entityType: 'DopsAssessment',
      entityId: record.id,
      summary: `DOPS assessment recorded (${procedureName}, overall ${overallRating}/9)`,
      details: { residentId, procedureName, overallRating, outcome: outcomeFor(overallRating) },
    });

    return jsonOk({ id: record.id, outcome: outcomeFor(overallRating) }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

import { jsonOk, jsonError, requireAuthWithProgram, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { listCohorts, createCohort, CohortServiceError } from '@/server/services/cohort-service';
import { createCohortSchema } from '@/lib/validation/session';
import { Role } from '@prisma/client';

export async function GET() {
  try {
    // scope cohort list to the user's active program.
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const cohorts = await listCohorts({ programId: gate.user.activeProgramId });
    return jsonOk({ cohorts });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    if (gate.user.role !== Role.PROGRAM_DIRECTOR && gate.user.role !== Role.ADMIN) {
      return jsonError('FORBIDDEN', 'Only PD or Admin can create cohorts', 403);
    }

    const body = await parseBody(req, createCohortSchema);
    if (!body.ok) return body.response;

    // New cohort is created in the user's active program. PDs that admin
    // multiple programs switch first, then create — never cross-tenant.
    const cohort = await createCohort(body.data, gate.user.id, gate.user.activeProgramId);
    return jsonOk({ cohort }, { status: 201 });
  } catch (err) {
    if (err instanceof CohortServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

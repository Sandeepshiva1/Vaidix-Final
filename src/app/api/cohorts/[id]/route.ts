import { jsonOk, jsonError, requireAuth, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { getCohort, updateCohort, deleteCohort, CohortServiceError } from '@/server/services/cohort-service';
import { updateCohortSchema } from '@/lib/validation/session';
import { Role } from '@prisma/client';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const cohort = await getCohort(id);
    if (!cohort) return jsonError('NOT_FOUND', 'Cohort not found', 404);
    return jsonOk({ cohort });
  } catch (err) {
    console.error('[api/cohorts/[id] GET] failed:', err);
    return handleUnexpected(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    if (gate.user.role !== Role.PROGRAM_DIRECTOR && gate.user.role !== Role.ADMIN) {
      return jsonError('FORBIDDEN', 'Only PD or Admin can edit cohorts', 403);
    }

    const { id } = await ctx.params;
    const existing = await getCohort(id);
    if (!existing) return jsonError('NOT_FOUND', 'Cohort not found', 404);

    const body = await parseBody(req, updateCohortSchema);
    if (!body.ok) return body.response;

    const cohort = await updateCohort(id, body.data, gate.user.id);
    return jsonOk({ cohort });
  } catch (err) {
    if (err instanceof CohortServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    console.error('[api/cohorts/[id] PATCH] failed:', err);
    return handleUnexpected(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    if (gate.user.role !== Role.PROGRAM_DIRECTOR && gate.user.role !== Role.ADMIN) {
      return jsonError('FORBIDDEN', 'Only PD or Admin can delete cohorts', 403);
    }

    const { id } = await ctx.params;
    const existing = await getCohort(id);
    if (!existing) return jsonError('NOT_FOUND', 'Cohort not found', 404);

    await deleteCohort(id, gate.user.id);
    return jsonOk({ deleted: true });
  } catch (err) {
    console.error('[api/cohorts/[id] DELETE] failed:', err);
    return handleUnexpected(err);
  }
}

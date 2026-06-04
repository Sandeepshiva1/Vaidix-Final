import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { admit } from '@/server/services/admission-service';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; admissionId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { admissionId } = await ctx.params;
    await admit({ admissionId, actorId: gate.user.id, actorRole: gate.user.role });
    return jsonOk({ admitted: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'ADMISSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Admission not found', 404);
    if (msg === 'ALREADY_DECIDED') return jsonError('ALREADY_DECIDED', 'Admission already decided', 409);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host or co-host may admit', 403);
    return handleUnexpected(err);
  }
}

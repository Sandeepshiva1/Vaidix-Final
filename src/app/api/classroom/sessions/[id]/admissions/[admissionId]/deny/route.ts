import { jsonOk, jsonError, requireAuth, handleUnexpected, parseBody } from '@/server/services/api-helpers';
import { deny } from '@/server/services/admission-service';
import { z } from 'zod';

const denySchema = z.object({ reason: z.string().max(300).optional() });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; admissionId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, denySchema);
    if (!body.ok) return body.response;

    const { admissionId } = await ctx.params;
    await deny({
      admissionId,
      actorId: gate.user.id,
      actorRole: gate.user.role,
      reason: body.data.reason,
    });
    return jsonOk({ denied: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'ADMISSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Admission not found', 404);
    if (msg === 'ALREADY_DECIDED') return jsonError('ALREADY_DECIDED', 'Admission already decided', 409);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host or co-host may deny', 403);
    return handleUnexpected(err);
  }
}

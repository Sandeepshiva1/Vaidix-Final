import { jsonOk, jsonError, requireAuth, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { addMembers, removeMember } from '@/server/services/cohort-service';
import { addCohortMemberSchema } from '@/lib/validation/session';
import { Role } from '@prisma/client';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    if (gate.user.role !== Role.PROGRAM_DIRECTOR && gate.user.role !== Role.ADMIN) {
      return jsonError('FORBIDDEN', 'Only PD or Admin can manage cohort membership', 403);
    }

    const { id } = await ctx.params;
    const body = await parseBody(req, addCohortMemberSchema);
    if (!body.ok) return body.response;

    const added = await addMembers(id, body.data.userIds, gate.user.id);
    return jsonOk({ added: added.length });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    if (gate.user.role !== Role.PROGRAM_DIRECTOR && gate.user.role !== Role.ADMIN) {
      return jsonError('FORBIDDEN', 'Only PD or Admin can manage cohort membership', 403);
    }

    const { id } = await ctx.params;
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');
    if (!userId) return jsonError('MISSING_USER_ID', 'userId query param required', 400);

    await removeMember(id, userId, gate.user.id);
    return jsonOk({ removed: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

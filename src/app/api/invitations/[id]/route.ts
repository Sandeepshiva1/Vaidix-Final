import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { revokeInvitationSchema, updateInvitationSchema } from '@/lib/validation/auth';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { revokeInvitation, updateInvitation } from '@/server/services/invitation-service';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN, Role.PROGRAM_DIRECTOR);
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const inv = await db.invitation.findUnique({
      where: { id },
      include: {
        invitedBy: { select: { id: true, name: true, email: true } },
        programDirector: { select: { id: true, name: true, email: true, avatarUrl: true } },
        facultyMentor:   { select: { id: true, name: true, email: true, avatarUrl: true } },
        cohort:          { select: { id: true, name: true, academicYear: true } },
      },
    });
    if (!inv) return jsonError('NOT_FOUND', 'Invitation not found', 404);

    const timeline = await db.auditEvent.findMany({
      where: { entityType: 'invitation', entityId: id },
      orderBy: { createdAt: 'asc' },
      select: { eventType: true, summary: true, createdAt: true, success: true },
    });

    return jsonOk({ invitation: inv, timeline });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const parsed = await parseBody(req, updateInvitationSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const invitation = await updateInvitation(id, parsed.data, gate.user.id);
      return jsonOk({ invitation });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'NOT_FOUND')   return jsonError('NOT_FOUND',   'Invitation not found', 404);
      if (code === 'NOT_EDITABLE') return jsonError('NOT_EDITABLE', 'Only pending invitations can be edited', 409);
      if (code === 'INVALID_PD') return jsonError('INVALID', 'Selected user is not a Program Director', 400);
      if (code === 'INVALID_MENTOR') return jsonError('INVALID', 'Selected user is not a Faculty member', 400);
      if (code === 'INVALID_COHORT') return jsonError('INVALID', 'Selected cohort no longer exists', 400);
      throw err;
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const parsed = revokeInvitationSchema.safeParse(body);
    const reason = parsed.success ? parsed.data.reason : undefined;

    try {
      await revokeInvitation(id, gate.user.id, reason);
      return jsonOk({ message: 'Invitation revoked' });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'NOT_FOUND') return jsonError('NOT_FOUND', 'Invitation not found', 404);
      if (code === 'ALREADY_ACCEPTED') return jsonError('ALREADY_ACCEPTED', 'Cannot revoke — user already accepted', 409);
      throw err;
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}

import { db } from '@/lib/db';
import { Role, InvitationStatus, Prisma } from '@prisma/client';
import {
  createInvitationSchema,
  listInvitationsQuerySchema,
} from '@/lib/validation/auth';
import {
  jsonOk,
  jsonError,
  parseBody,
  parseQuery,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { createInvitation } from '@/server/services/invitation-service';
import { ADMIN_LIMIT_CODE, adminLimitMessage } from '@/server/services/admin-limits';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

export async function GET(req: Request) {
  try {
    const gate = await requireRole(Role.ADMIN, Role.PROGRAM_DIRECTOR);
    if (!gate.ok) return gate.response;

    const parsed = await parseQuery(req, listInvitationsQuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.data;

    const where: Prisma.InvitationWhereInput = {};
    if (q.status) where.status = q.status as InvitationStatus;
    if (q.role) where.role = q.role;
    if (q.invitedById) where.invitedById = q.invitedById;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    if (q.search) {
      where.OR = [
        { email: { contains: q.search, mode: 'insensitive' } },
        { fullName: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    const invitations = await db.invitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        subspecialty: true,
        department: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        resendCount: true,
        lastResentAt: true,
        createdAt: true,
        invitedBy: { select: { id: true, name: true, email: true } },
      },
    });

    const counts = await db.invitation.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const summary = { total: 0, pending: 0, accepted: 0, expired: 0, revoked: 0 };
    for (const c of counts) {
      summary.total += c._count._all;
      const key = c.status.toLowerCase() as keyof typeof summary;
      if (key in summary) summary[key] = c._count._all;
    }

    return jsonOk({
      invitations,
      summary,
      nextCursor: invitations.length === q.limit ? invitations[invitations.length - 1].id : null,
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const rl = await checkRateLimit({
      bucket: `invite-create:${gate.user.id}`,
      ...LIMITS.INVITATION_CREATE,
    });
    if (!rl.allowed) {
      return jsonError('RATE_LIMITED', 'Rate limit reached for invitations', 429);
    }

    const parsed = await parseBody(req, createInvitationSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const invitation = await createInvitation({
        ...parsed.data,
        invitedById: gate.user.id,
        invitedByName: gate.user.name,
      });
      return jsonOk({ invitation }, { status: 201 });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'USER_EXISTS') return jsonError('USER_EXISTS', 'A user with this email already exists', 409);
      if (code === 'PENDING_INVITE_EXISTS') return jsonError('DUPLICATE', 'A pending invitation already exists for this email', 409);
      if (code === 'MOBILE_EXISTS') return jsonError('MOBILE_EXISTS', 'A user with this mobile number already has an account', 409);
      if (code === 'MOBILE_INVITE_EXISTS') return jsonError('DUPLICATE', 'A pending invitation already uses this mobile number', 409);
      if (code === 'INVALID_PD') return jsonError('INVALID', 'Selected user is not a Program Director', 400);
      if (code === 'INVALID_MENTOR') return jsonError('INVALID', 'Selected user is not a Faculty member', 400);
      if (code === 'INVALID_COHORT') return jsonError('INVALID', 'Selected cohort no longer exists', 400);
      if (code === ADMIN_LIMIT_CODE) return jsonError('ADMIN_LIMIT', adminLimitMessage, 409);
      throw err;
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}

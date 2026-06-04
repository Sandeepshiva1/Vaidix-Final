// ════════════════════════════════════════════════════════════════════════════
// User Admin Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Admin-only operations on User rows: list/search, change role, change status
// (suspend / reactivate / deactivate). All mutations write an audit entry and
// append to UserRoleHistory when role changes.

import { db } from '@/lib/db';
import { Role, UserStatus, Prisma } from '@prisma/client';
import { audit, AUDIT_EVENTS } from './audit';
import { sendEmail } from '@/lib/email';

export interface ListUsersArgs {
  role?: Role;
  status?: UserStatus;
  search?: string;
  limit: number;
  cursor?: string;
}

export async function listUsers(args: ListUsersArgs) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
  };
  if (args.role) where.role = args.role;
  if (args.status) where.status = args.status;
  if (args.search) {
    where.OR = [
      { email: { contains: args.search, mode: 'insensitive' } },
      { name: { contains: args.search, mode: 'insensitive' } },
    ];
  }

  const users = await db.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      avatarUrl: true,
      lastLoginAt: true,
      lockedUntil: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: args.limit,
    ...(args.cursor ? { skip: 1, cursor: { id: args.cursor } } : {}),
  });

  return {
    users,
    nextCursor: users.length === args.limit ? users[users.length - 1].id : null,
  };
}

export async function getUser(userId: string) {
  return db.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      avatarUrl: true,
      lastLoginAt: true,
      lockedUntil: true,
      failedLoginCount: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
      roleHistory: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          previousRole: true,
          newRole: true,
          changedBy: true,
          createdAt: true,
          reason: true,
        },
      },
    },
  });
}

// ----------------------------------------------------------------------------
// Role change
// ----------------------------------------------------------------------------
export async function changeUserRole(args: {
  targetUserId: string;
  newRole: Role;
  actorId: string;
  reason?: string | null;
}) {
  if (args.targetUserId === args.actorId) {
    throw new Error('CANNOT_MODIFY_SELF');
  }

  const target = await db.user.findFirst({
    where: { id: args.targetUserId, deletedAt: null },
    select: { id: true, role: true, name: true, email: true },
  });
  if (!target) throw new Error('USER_NOT_FOUND');
  if (target.role === args.newRole) {
    return { id: target.id, role: target.role, unchanged: true };
  }

  await db.$transaction([
    db.user.update({
      where: { id: target.id },
      data: { role: args.newRole },
    }),
    db.userRoleHistory.create({
      data: {
        userId: target.id,
        previousRole: target.role,
        newRole: args.newRole,
        changedBy: args.actorId,
        reason: args.reason ?? null,
      },
    }),
  ]);

  await audit({
    actorId: args.actorId,
    eventType: AUDIT_EVENTS.USER_ROLE_CHANGED,
    entityType: 'user',
    entityId: target.id,
    summary: `Role changed ${target.role} → ${args.newRole}`,
    details: { previousRole: target.role, newRole: args.newRole, reason: args.reason ?? null },
  });

  return { id: target.id, role: args.newRole, unchanged: false };
}

// ----------------------------------------------------------------------------
// Status change — SUSPEND / REACTIVATE / DEACTIVATE
// ----------------------------------------------------------------------------
export async function changeUserStatus(args: {
  targetUserId: string;
  newStatus: Extract<UserStatus, 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>;
  actorId: string;
  reason?: string | null;
}) {
  if (args.targetUserId === args.actorId) {
    throw new Error('CANNOT_MODIFY_SELF');
  }

  const target = await db.user.findFirst({
    where: { id: args.targetUserId, deletedAt: null },
    select: { id: true, status: true, name: true, email: true },
  });
  if (!target) throw new Error('USER_NOT_FOUND');
  if (target.status === 'PENDING_INVITE') {
    throw new Error('USER_NOT_ONBOARDED');
  }
  if (target.status === args.newStatus) {
    return { id: target.id, status: target.status, unchanged: true };
  }

  // Status transition invalidates all active sessions immediately by bumping
  // passwordVersion (NextAuth jwt callback rejects stale versions).
  await db.user.update({
    where: { id: target.id },
    data: {
      status: args.newStatus,
      passwordVersion:
        args.newStatus === 'SUSPENDED' || args.newStatus === 'DEACTIVATED'
          ? { increment: 1 }
          : undefined,
      lockedUntil: args.newStatus === 'ACTIVE' ? null : undefined,
      failedLoginCount: args.newStatus === 'ACTIVE' ? 0 : undefined,
    },
  });

  await audit({
    actorId: args.actorId,
    eventType: AUDIT_EVENTS.USER_STATUS_CHANGED,
    entityType: 'user',
    entityId: target.id,
    summary: `Status changed ${target.status} → ${args.newStatus}`,
    details: { previousStatus: target.status, newStatus: args.newStatus, reason: args.reason ?? null },
  });

  // Courtesy email. Failures do not block the status change.
  if (args.newStatus === 'SUSPENDED') {
    sendEmail({
      to: target.email,
      subject: 'Your Vaidix account has been suspended',
      html: `<p>Hi ${target.name.split(' ')[0]},</p>
        <p>Your Vaidix account has been suspended by an administrator.
        Please contact your Program Director if you believe this is a mistake.</p>
        ${args.reason ? `<p><strong>Reason:</strong> ${args.reason}</p>` : ''}`,
    }).catch((err) => {
      console.error('[user-admin] suspension email failed', err);
    });
  }

  return { id: target.id, status: args.newStatus, unchanged: false };
}

// ----------------------------------------------------------------------------
// Update profile / identity fields
// ----------------------------------------------------------------------------
//
// Email is intentionally NOT editable here. Changing email mid-session would
// invalidate every reference to the old address (audit log, invitation log,
// reset-password flow, ical feed) without a verification round-trip. If the
// pilot ever needs it, ship a "change email" flow with re-verification first.

export interface UpdateUserDetailsInput {
  name?: string;
  mobile?: string | null;
  username?: string | null;
  /**
   * Faculty → Program Director mapping. Only meaningful when target.role is
   * FACULTY. Service rejects assignment to a non-PD user. `null` clears.
   * Absent leaves untouched.
   */
  programDirectorId?: string | null;
  /**
   * Resident → Faculty mentor mapping. Only meaningful when target.role is
   * RESIDENT. Service rejects assignment to a non-FACULTY user. `null` clears.
   * Independent of cohort membership.
   */
  facultyMentorId?: string | null;
  /**
   * Profile photo URL. Produced by the avatar presign route. `null` clears.
   * Absent leaves untouched.
   */
  avatarUrl?: string | null;
  /**
   * Resident cohort assignment. Replaces current memberships with this single
   * cohort (so the resident can only be in one cohort at a time via the admin
   * UI; bulk membership stays in the cohort drawer). null clears all
   * memberships. Service rejects this when target.role !== RESIDENT.
   */
  cohortId?: string | null;
  profile?: {
    subspecialty?: string | null;
    yearOfResidency?: number | null;
    affiliation?: string | null;
    bio?: string | null;
    timezone?: string | null;
    mciRegNumber?: string | null;
    gender?: string | null;
  };
}

export class UserAdminError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID',
    message: string
  ) {
    super(message);
  }
}

export async function updateUserDetails(args: {
  targetUserId: string;
  actorId: string;
  data: UpdateUserDetailsInput;
}) {
  const target = await db.user.findFirst({
    where: { id: args.targetUserId, deletedAt: null },
    select: {
      id: true, name: true, mobile: true, username: true, role: true,
      programDirectorId: true, facultyMentorId: true, avatarUrl: true,
    },
  });
  if (!target) throw new UserAdminError('NOT_FOUND', 'User not found');

  // Uniqueness pre-check on mobile / username — gives a clean error message
  // instead of letting Prisma's P2002 bubble up with a cryptic constraint name.
  if (args.data.mobile && args.data.mobile !== target.mobile) {
    const taken = await db.user.findFirst({
      where: { mobile: args.data.mobile, NOT: { id: target.id } },
      select: { id: true },
    });
    if (taken) throw new UserAdminError('CONFLICT', 'Mobile number already in use');
  }
  if (args.data.username && args.data.username !== target.username) {
    const taken = await db.user.findFirst({
      where: { username: args.data.username, NOT: { id: target.id } },
      select: { id: true },
    });
    if (taken) throw new UserAdminError('CONFLICT', 'Username already taken');
  }

  // PD link guards: target must currently be FACULTY (or be becoming one in
  // the same edit, but role transitions go through changeUserRole *before*
  // this method per the admin modal flow), and the referenced PD must really
  // be a PROGRAM_DIRECTOR. Both checks live here so a future API consumer
  // (e.g. SCIM bulk import) can't bypass them via the route layer.
  let pdChange: { from: string | null; to: string | null } | null = null;
  if (args.data.programDirectorId !== undefined) {
    const nextPdId = args.data.programDirectorId;
    if (nextPdId !== target.programDirectorId) {
      if (nextPdId) {
        if (target.role !== Role.FACULTY) {
          throw new UserAdminError('INVALID', 'Only FACULTY users can be linked to a Program Director');
        }
        if (nextPdId === target.id) {
          throw new UserAdminError('INVALID', 'A faculty member cannot be their own PD');
        }
        const pd = await db.user.findFirst({
          where: { id: nextPdId, deletedAt: null },
          select: { id: true, role: true },
        });
        if (!pd) throw new UserAdminError('NOT_FOUND', 'Program Director user not found');
        if (pd.role !== Role.PROGRAM_DIRECTOR) {
          throw new UserAdminError('INVALID', 'Referenced user must have role PROGRAM_DIRECTOR');
        }
      }
      pdChange = { from: target.programDirectorId, to: nextPdId };
    }
  }

  // Faculty mentor link guards (parallel to PD): target must be RESIDENT,
  // ref must be FACULTY, no self-loops.
  let mentorChange: { from: string | null; to: string | null } | null = null;
  if (args.data.facultyMentorId !== undefined) {
    const nextMentorId = args.data.facultyMentorId;
    if (nextMentorId !== target.facultyMentorId) {
      if (nextMentorId) {
        if (target.role !== Role.RESIDENT) {
          throw new UserAdminError('INVALID', 'Only RESIDENT users can be linked to a Faculty mentor');
        }
        if (nextMentorId === target.id) {
          throw new UserAdminError('INVALID', 'A user cannot mentor themselves');
        }
        const mentor = await db.user.findFirst({
          where: { id: nextMentorId, deletedAt: null },
          select: { id: true, role: true },
        });
        if (!mentor) throw new UserAdminError('NOT_FOUND', 'Faculty mentor user not found');
        if (mentor.role !== Role.FACULTY) {
          throw new UserAdminError('INVALID', 'Referenced user must have role FACULTY');
        }
      }
      mentorChange = { from: target.facultyMentorId, to: nextMentorId };
    }
  }

  const userPatch: Prisma.UserUpdateInput = {};
  if (args.data.name !== undefined) userPatch.name = args.data.name.trim();
  if (args.data.mobile !== undefined) userPatch.mobile = args.data.mobile || null;
  if (args.data.username !== undefined) userPatch.username = args.data.username || null;
  if (args.data.avatarUrl !== undefined) userPatch.avatarUrl = args.data.avatarUrl || null;
  if (pdChange) {
    userPatch.programDirector = pdChange.to
      ? { connect: { id: pdChange.to } }
      : { disconnect: true };
  }
  if (mentorChange) {
    userPatch.facultyMentor = mentorChange.to
      ? { connect: { id: mentorChange.to } }
      : { disconnect: true };
  }

  // Cohort membership reconcile (resident-only). Done in the same transaction
  // as the user update so a partial failure leaves no orphaned membership rows.
  let cohortChange: { from: string[]; to: string | null } | null = null;
  if (args.data.cohortId !== undefined) {
    // Assigning a cohort requires RESIDENT. Clearing (null) is allowed for
    // any role — leaves no orphaned membership when the resident is promoted.
    if (args.data.cohortId) {
      if (target.role !== Role.RESIDENT) {
        throw new UserAdminError('INVALID', 'Only RESIDENT users can be assigned to a cohort here');
      }
      const cohort = await db.cohort.findFirst({
        where: { id: args.data.cohortId, deletedAt: null },
        select: { id: true },
      });
      if (!cohort) throw new UserAdminError('NOT_FOUND', 'Cohort not found');
    }
    const current = await db.cohortMember.findMany({
      where: { userId: target.id },
      select: { cohortId: true },
    });
    cohortChange = {
      from: current.map((m) => m.cohortId),
      to: args.data.cohortId,
    };
  }

  const profilePatch: Prisma.UserProfileUpdateInput = {};
  const profileCreate: Prisma.UserProfileCreateWithoutUserInput = {};
  if (args.data.profile) {
    const p = args.data.profile;
    if (p.subspecialty !== undefined) {
      profilePatch.subspecialty = p.subspecialty || null;
      profileCreate.subspecialty = p.subspecialty || null;
    }
    if (p.yearOfResidency !== undefined) {
      profilePatch.yearOfResidency = p.yearOfResidency;
      profileCreate.yearOfResidency = p.yearOfResidency;
    }
    if (p.affiliation !== undefined) {
      profilePatch.affiliation = p.affiliation || null;
      profileCreate.affiliation = p.affiliation || null;
    }
    if (p.bio !== undefined) {
      profilePatch.bio = p.bio || null;
      profileCreate.bio = p.bio || null;
    }
    if (p.timezone !== undefined) {
      profilePatch.timezone = p.timezone || null;
      profileCreate.timezone = p.timezone || null;
    }
    if (p.mciRegNumber !== undefined) {
      profilePatch.mciRegNumber = p.mciRegNumber || null;
      profileCreate.mciRegNumber = p.mciRegNumber || null;
    }
    if (p.gender !== undefined) {
      profilePatch.gender = p.gender || null;
      profileCreate.gender = p.gender || null;
    }
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        ...userPatch,
        ...(args.data.profile
          ? {
              profile: {
                upsert: {
                  create: profileCreate,
                  update: profilePatch,
                },
              },
            }
          : {}),
      },
    });

    if (cohortChange) {
      // Replace any existing memberships with the single new one (or none).
      await tx.cohortMember.deleteMany({ where: { userId: target.id } });
      if (cohortChange.to) {
        await tx.cohortMember.create({
          data: {
            cohortId: cohortChange.to,
            userId: target.id,
            addedBy: args.actorId,
          },
        });
      }
    }
  });

  await audit({
    actorId: args.actorId,
    eventType: AUDIT_EVENTS.USER_UPDATED,
    entityType: 'user',
    entityId: target.id,
    summary: `User details updated`,
    details: {
      changedFields: [
        ...Object.keys(userPatch),
        ...(args.data.profile ? Object.keys(args.data.profile) : []),
        ...(cohortChange ? ['cohortMembership'] : []),
      ],
      ...(cohortChange ? { cohortChange } : {}),
    },
  });

  if (pdChange) {
    await audit({
      actorId: args.actorId,
      eventType: pdChange.to ? AUDIT_EVENTS.FACULTY_PD_ASSIGNED : AUDIT_EVENTS.FACULTY_PD_CLEARED,
      entityType: 'user',
      entityId: target.id,
      summary: pdChange.to
        ? `Linked faculty to Program Director`
        : `Cleared faculty's Program Director link`,
      details: pdChange,
    });
  }

  return { id: target.id };
}

// ════════════════════════════════════════════════════════════════════════════
// Invitation Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Create / accept / revoke / resend invitations. Email dispatch + audit.

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email';
import {
  renderInvitationEmail,
  renderWelcomeEmail,
  renderInviteAcceptedAdminEmail,
} from '@/lib/email-templates';
import { mintToken } from './tokens';
import {
  hashPassword,
  candidateUsernameFromEmail,
  pickAvailableUsername,
} from './auth-service';
import { canonicaliseMobile } from '@/lib/validation/primitives';
import { audit, AUDIT_EVENTS } from './audit';
import { emit } from './notifications-service';
import { InvitationStatus, UserStatus, type Role } from '@prisma/client';
import type { CreateInvitationInput, UpdateInvitationInput } from '@/lib/validation/auth';

const TOKEN_LENGTH_BYTES = 32;

interface CreateArgs extends CreateInvitationInput {
  invitedById: string;
  invitedByName: string;
}

// Validates that a hierarchy mapping is compatible with the invited role and
// that the referenced rows exist. Returns the cleaned (role-applicable) IDs.
// Throws Error('INVALID_PD') / Error('INVALID_COHORT') on bad references.
async function resolveMapping(args: {
  role: Role;
  programDirectorId: string | null;
  facultyMentorId: string | null;
  cohortId: string | null;
}): Promise<{
  programDirectorId: string | null;
  facultyMentorId: string | null;
  cohortId: string | null;
}> {
  const pdId     = args.role === 'FACULTY'  ? args.programDirectorId : null;
  const mentorId = args.role === 'RESIDENT' ? args.facultyMentorId   : null;
  const cohortId = args.role === 'RESIDENT' ? args.cohortId          : null;

  if (pdId) {
    const pd = await db.user.findFirst({
      where: { id: pdId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!pd || pd.role !== 'PROGRAM_DIRECTOR') throw new Error('INVALID_PD');
  }
  if (mentorId) {
    const m = await db.user.findFirst({
      where: { id: mentorId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!m || m.role !== 'FACULTY') throw new Error('INVALID_MENTOR');
  }
  if (cohortId) {
    const c = await db.cohort.findFirst({
      where: { id: cohortId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new Error('INVALID_COHORT');
  }
  return { programDirectorId: pdId, facultyMentorId: mentorId, cohortId };
}

export async function createInvitation(args: CreateArgs) {
  const existingUser = await db.user.findUnique({
    where: { email: args.email },
    select: { id: true },
  });
  if (existingUser) {
    throw new Error('USER_EXISTS');
  }

  const livePending = await db.invitation.findFirst({
    where: { email: args.email, status: InvitationStatus.PENDING },
    select: { id: true },
  });
  if (livePending) {
    throw new Error('PENDING_INVITE_EXISTS');
  }

  // Mobile is a unique login identifier (multi-identifier login). Catch
  // collisions at invite-creation time so the admin sees an error immediately
  // rather than discovering silently at accept-time that the mobile was dropped.
  if (args.mobile) {
    const canonical = canonicaliseMobile(args.mobile);
    if (canonical) {
      const [mobileUser, mobilePending] = await Promise.all([
        db.user.findUnique({ where: { mobile: canonical }, select: { id: true } }),
        db.invitation.findFirst({
          where: { mobile: canonical, status: InvitationStatus.PENDING },
          select: { id: true },
        }),
      ]);
      if (mobileUser) throw new Error('MOBILE_EXISTS');
      if (mobilePending) throw new Error('MOBILE_INVITE_EXISTS');
    }
  }

  // Validate hierarchy mapping against role. Mappings are silently dropped
  // for non-applicable roles (e.g. cohortId on a FACULTY invite) so the UI
  // can send everything it has without a separate per-role payload shape.
  const { programDirectorId, facultyMentorId, cohortId } = await resolveMapping({
    role: args.role,
    programDirectorId: args.programDirectorId ?? null,
    facultyMentorId:   args.facultyMentorId ?? null,
    cohortId:          args.cohortId ?? null,
  });

  const token = mintToken(TOKEN_LENGTH_BYTES);
  const expiresAt = new Date(Date.now() + args.expiresInHours * 3600 * 1000);

  const invitation = await db.invitation.create({
    data: {
      email: args.email,
      fullName: args.fullName,
      mobile: args.mobile ?? null,
      mciRegNumber: args.mciRegNumber ?? null,
      role: args.role,
      subspecialty: args.subspecialty ?? null,
      department: args.department ?? null,
      yearOfResidency: args.yearOfResidency ?? null,
      programDirectorId,
      facultyMentorId,
      cohortId,
      avatarUrl: args.avatarUrl ?? null,
      gender: args.gender ?? null,
      moduleOverrides: args.moduleOverrides as object,
      token,
      status: InvitationStatus.PENDING,
      invitedById: args.invitedById,
      expiresAt,
    },
  });

  await audit({
    actorId: args.invitedById,
    eventType: AUDIT_EVENTS.INVITATION_CREATED,
    entityType: 'invitation',
    entityId: invitation.id,
    summary: `Invited ${args.fullName} (${args.email}) as ${args.role}`,
    details: {
      email: args.email,
      role: args.role,
      subspecialty: args.subspecialty,
    },
  });

  await deliverInvitationEmail(invitation, args.invitedByName);

  return invitation;
}

async function deliverInvitationEmail(
  invitation: Awaited<ReturnType<typeof db.invitation.create>>,
  inviterName: string
) {
  const acceptUrl = `${env.NEXTAUTH_URL}/invitations/${invitation.token}`;
  const { subject, html } = renderInvitationEmail({
    invitedName: invitation.fullName ?? invitation.email.split('@')[0],
    invitedEmail: invitation.email,
    inviterName,
    role: humanRole(invitation.role),
    subspecialty: invitation.subspecialty,
    department: invitation.department,
    acceptUrl,
    expiresAt: invitation.expiresAt,
  });

  try {
    await sendEmail({ to: invitation.email, subject, html });
    await audit({
      actorId: invitation.invitedById,
      eventType: AUDIT_EVENTS.INVITATION_SENT,
      entityType: 'invitation',
      entityId: invitation.id,
      summary: `Email delivered to ${invitation.email}`,
    });
  } catch (err) {
    console.error('[invitation] email send failed:', err);
    await audit({
      actorId: invitation.invitedById,
      eventType: AUDIT_EVENTS.INVITATION_SENT,
      entityType: 'invitation',
      entityId: invitation.id,
      summary: `Email delivery FAILED to ${invitation.email}`,
      details: { error: (err as Error).message },
      success: false,
    });
  }
}

export async function updateInvitation(
  invitationId: string,
  patch: UpdateInvitationInput,
  actorId: string
) {
  const inv = await db.invitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw new Error('NOT_FOUND');
  if (inv.status !== InvitationStatus.PENDING) throw new Error('NOT_EDITABLE');

  const data: Record<string, unknown> = {};
  if (patch.fullName        !== undefined) data.fullName        = patch.fullName;
  if (patch.mobile          !== undefined) data.mobile          = patch.mobile ?? null;
  if (patch.mciRegNumber    !== undefined) data.mciRegNumber    = patch.mciRegNumber ?? null;
  if (patch.role            !== undefined) data.role            = patch.role;
  if (patch.subspecialty    !== undefined) data.subspecialty    = patch.subspecialty ?? null;
  if (patch.department      !== undefined) data.department      = patch.department ?? null;
  if (patch.yearOfResidency !== undefined) data.yearOfResidency = patch.yearOfResidency ?? null;
  if (patch.moduleOverrides !== undefined) data.moduleOverrides = patch.moduleOverrides as object;
  if (patch.expiresInHours  !== undefined) {
    data.expiresAt = new Date(Date.now() + patch.expiresInHours * 3600 * 1000);
  }
  if (patch.avatarUrl !== undefined) data.avatarUrl = patch.avatarUrl ?? null;
  if (patch.gender    !== undefined) data.gender    = patch.gender ?? null;

  // Mappings: re-validate against the (possibly new) role. If the role is
  // changing, we re-resolve from the PATCH role; otherwise the stored role.
  if (
    patch.programDirectorId !== undefined ||
    patch.facultyMentorId !== undefined ||
    patch.cohortId !== undefined ||
    patch.role !== undefined
  ) {
    const effectiveRole = patch.role ?? inv.role;
    const resolved = await resolveMapping({
      role: effectiveRole,
      programDirectorId:
        patch.programDirectorId !== undefined
          ? (patch.programDirectorId ?? null)
          : inv.programDirectorId,
      facultyMentorId:
        patch.facultyMentorId !== undefined
          ? (patch.facultyMentorId ?? null)
          : inv.facultyMentorId,
      cohortId:
        patch.cohortId !== undefined
          ? (patch.cohortId ?? null)
          : inv.cohortId,
    });
    data.programDirectorId = resolved.programDirectorId;
    data.facultyMentorId   = resolved.facultyMentorId;
    data.cohortId          = resolved.cohortId;
  }

  const updated = await db.invitation.update({
    where: { id: invitationId },
    data,
  });

  await audit({
    actorId,
    eventType: AUDIT_EVENTS.INVITATION_UPDATED,
    entityType: 'invitation',
    entityId: invitationId,
    summary: `Updated invitation for ${inv.email}`,
    details: { changedFields: Object.keys(data) },
  });

  return updated;
}

export async function resendInvitation(invitationId: string, inviterName: string) {
  const inv = await db.invitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw new Error('NOT_FOUND');
  if (inv.status === InvitationStatus.ACCEPTED) throw new Error('ALREADY_ACCEPTED');
  if (inv.status === InvitationStatus.REVOKED) throw new Error('REVOKED');

  const token = mintToken(TOKEN_LENGTH_BYTES);
  const hours = 48;
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

  const updated = await db.invitation.update({
    where: { id: invitationId },
    data: {
      token,
      status: InvitationStatus.PENDING,
      expiresAt,
      lastResentAt: new Date(),
      resendCount: { increment: 1 },
    },
  });

  await audit({
    actorId: inv.invitedById,
    eventType: AUDIT_EVENTS.INVITATION_RESENT,
    entityType: 'invitation',
    entityId: invitationId,
    summary: `Re-sent to ${inv.email}`,
  });

  await deliverInvitationEmail(updated, inviterName);
  return updated;
}

export async function revokeInvitation(invitationId: string, actorId: string, reason?: string) {
  const inv = await db.invitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw new Error('NOT_FOUND');
  if (inv.status === InvitationStatus.ACCEPTED) throw new Error('ALREADY_ACCEPTED');

  await db.invitation.update({
    where: { id: invitationId },
    data: {
      status: InvitationStatus.REVOKED,
      revokedAt: new Date(),
      revokedReason: reason ?? null,
    },
  });

  await audit({
    actorId,
    eventType: AUDIT_EVENTS.INVITATION_REVOKED,
    entityType: 'invitation',
    entityId: invitationId,
    summary: `Revoked invitation for ${inv.email}`,
    details: { reason },
  });
}

export async function deleteInvitation(invitationId: string, actorId: string, reason?: string) {
  const inv = await db.invitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw new Error('NOT_FOUND');
  if (inv.status === InvitationStatus.ACCEPTED) throw new Error('ALREADY_ACCEPTED');

  await audit({
    actorId,
    eventType: AUDIT_EVENTS.INVITATION_DELETED,
    entityType: 'invitation',
    entityId: invitationId,
    summary: `Hard-deleted invitation for ${inv.email}`,
    details: {
      reason,
      snapshot: {
        email: inv.email,
        role: inv.role,
        status: inv.status,
        createdAt: inv.createdAt,
      },
    },
  });

  await db.invitation.delete({ where: { id: invitationId } });
}

export async function acceptInvitation(
  token: string,
  password: string,
  meta: { ipAddress: string | null; userAgent: string | null }
) {
  const inv = await db.invitation.findUnique({ where: { token } });
  if (!inv) throw new Error('INVALID_TOKEN');
  if (inv.status !== InvitationStatus.PENDING) throw new Error('NOT_PENDING');
  if (inv.expiresAt < new Date()) {
    await db.invitation.update({
      where: { id: inv.id },
      data: { status: InvitationStatus.EXPIRED },
    });
    throw new Error('EXPIRED');
  }

  const existingUser = await db.user.findUnique({ where: { email: inv.email } });
  if (existingUser) throw new Error('USER_EXISTS');

  // W6.11 — figure out which program this new user lands in. Order:
  //   1. Cohort's program (if cohortId on the invitation)
  //   2. Inviter's currently active program
  //   3. The default LVPEI MS Ophthalmology program
  // The Invitation model does NOT (yet) carry a programId column; that's a
  // Phase-2 schema addition once admins routinely manage > 1 program. For
  // now we derive at accept time so existing W3 invitation flows keep working.
  let assignedProgramId: string | null = null;
  if (inv.cohortId) {
    const c = await db.cohort.findUnique({
      where: { id: inv.cohortId },
      select: { programId: true },
    });
    assignedProgramId = c?.programId ?? null;
  }
  if (!assignedProgramId) {
    const inviter = await db.user.findUnique({
      where: { id: inv.invitedById },
      select: { activeProgramId: true },
    });
    assignedProgramId = inviter?.activeProgramId ?? null;
  }
  if (!assignedProgramId) {
    const fallback = await db.program.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    assignedProgramId = fallback?.id ?? null;
  }
  if (!assignedProgramId) {
    // No active programs in the system at all — extremely unlikely (the seed
    // always creates one) but throw early so the user creation rolls back
    // cleanly rather than producing a half-baked tenant-less account.
    throw new Error('NO_ACTIVE_PROGRAM');
  }

  const passwordHash = await hashPassword(password);

  // Multi-identifier login (B-track): canonicalise the invited mobile and
  // generate a username candidate. Mobile may be null (optional at invite
  // time); username is always seeded so the user can log in by it from day 1.
  const canonicalMobile = inv.mobile ? canonicaliseMobile(inv.mobile) : null;
  let usernameCandidate = await pickAvailableUsername(candidateUsernameFromEmail(inv.email));

  const user = await db.$transaction(async (tx) => {
    // If the canonicalised mobile collides with another user, drop it from
    // the new row rather than aborting the whole accept-invitation flow.
    // Operator can reconcile via /admin/users.
    let mobileToStore: string | null = canonicalMobile;
    if (mobileToStore) {
      const collision = await tx.user.findUnique({
        where: { mobile: mobileToStore },
        select: { id: true },
      });
      if (collision) mobileToStore = null;
    }

    // Hierarchy mapping baked into the User row at creation. Only the field
    // that's role-applicable lands here:
    //   - FACULTY  → programDirectorId
    //   - RESIDENT → facultyMentorId
    // Cohort assignment is a separate join row inserted below.
    const programDirectorIdToApply = inv.role === 'FACULTY'  ? inv.programDirectorId : null;
    const facultyMentorIdToApply   = inv.role === 'RESIDENT' ? inv.facultyMentorId   : null;

    const userCreateData = {
      email: inv.email,
      mobile: mobileToStore,
      username: usernameCandidate,
      name: inv.fullName ?? inv.email.split('@')[0],
      passwordHash,
      role: inv.role,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      avatarUrl: inv.avatarUrl,
      programDirectorId: programDirectorIdToApply,
      facultyMentorId: facultyMentorIdToApply,
      // W6.11 — every new user lands in a program from day 1 so the cohort/
      // session lists never 409 NO_ACTIVE_PROGRAM on first login.
      activeProgramId: assignedProgramId,
      profile: {
        create: {
          mciRegNumber: inv.mciRegNumber,
          yearOfResidency: inv.yearOfResidency,
          subspecialty: inv.subspecialty,
          affiliation: inv.department,
          gender: inv.gender,
          languages: ['en'],
          timezone: 'Asia/Kolkata',
        },
      },
      preferences: { create: {} },
      stats: { create: {} },
    };

    let u;
    try {
      u = await tx.user.create({ data: userCreateData });
    } catch (err) {
      // Race-safe retry: if the username we picked got grabbed by a parallel
      // invitation accept between our pickAvailableUsername() and create(),
      // the unique constraint fires (Prisma P2002). Retry once with a new
      // candidate; further collisions are exceedingly unlikely in practice.
      const e = err as { code?: string; meta?: { target?: string[] } };
      if (e.code === 'P2002' && (e.meta?.target ?? []).includes('username')) {
        usernameCandidate = await pickAvailableUsername(
          candidateUsernameFromEmail(inv.email)
        );
        u = await tx.user.create({
          data: { ...userCreateData, username: usernameCandidate },
        });
      } else {
        throw err;
      }
    }

    // W6.11 — register the membership inside the transaction so accept/create
    // either both succeed or both roll back. assignedProgramId is computed
    // above (cohort program → inviter active → first ACTIVE → throw).
    await tx.programMembership.create({
      data: {
        userId: u.id,
        programId: assignedProgramId,
        addedBy: inv.invitedById,
      },
    });

    // Cohort assignment for residents. Skipped silently if the cohort got
    // archived/deleted between invite and accept (the FK is SET NULL but
    // we double-check the pointer to avoid a stale CohortMember insert).
    if (inv.role === 'RESIDENT' && inv.cohortId) {
      const cohort = await tx.cohort.findFirst({
        where: { id: inv.cohortId, deletedAt: null },
        select: { id: true },
      });
      if (cohort) {
        await tx.cohortMember.create({
          data: {
            cohortId: cohort.id,
            userId: u.id,
            addedBy: inv.invitedById,
          },
        });
      }
    }

    // Apply module overrides from invitation → per-user permissions.
    const overrides = (inv.moduleOverrides as { granted?: string[]; revoked?: string[] } | null) ?? {};
    const grants = overrides.granted ?? [];
    const revokes = overrides.revoked ?? [];
    if (grants.length || revokes.length) {
      await tx.userModulePermission.createMany({
        data: [
          ...grants.map((moduleKey) => ({ userId: u.id, moduleKey, granted: true, grantedBy: inv.invitedById })),
          ...revokes.map((moduleKey) => ({ userId: u.id, moduleKey, granted: false, grantedBy: inv.invitedById })),
        ],
        skipDuplicates: true,
      });
    }

    await tx.invitation.update({
      where: { id: inv.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedUserId: u.id,
      },
    });

    return u;
  });

  await audit({
    actorId: user.id,
    eventType: AUDIT_EVENTS.INVITATION_ACCEPTED,
    entityType: 'invitation',
    entityId: inv.id,
    summary: `Invitation accepted — new user ${user.email}`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  await audit({
    actorId: user.id,
    eventType: AUDIT_EVENTS.USER_CREATED,
    entityType: 'user',
    entityId: user.id,
    summary: `User account created via invitation`,
  });

  // Notification emails (fire-and-forget)
  const loginUrl = `${env.NEXTAUTH_URL}/login`;
  const inviter = await db.user.findUnique({
    where: { id: inv.invitedById },
    select: { id: true, email: true, name: true, status: true },
  });

  sendEmail({
    to: user.email,
    ...renderWelcomeEmail({ userName: user.name, role: humanRole(inv.role), loginUrl }),
  }).catch((err) => console.error('[invitation.accept] welcome email failed:', err));

  if (inviter) {
    sendEmail({
      to: inviter.email,
      ...renderInviteAcceptedAdminEmail({
        adminName: inviter.name,
        invitedUserName: user.name,
        invitedUserEmail: user.email,
        role: humanRole(inv.role),
      }),
    }).catch((err) => console.error('[invitation.accept] admin notify failed:', err));

    if (inviter.status === UserStatus.ACTIVE) {
      await emit({
        userId: inviter.id,
        kind: 'invitation.accepted',
        title: `${user.name} accepted your invitation`,
        body: `${humanRole(inv.role)} — ${user.email}`,
        payload: { invitedUserId: user.id, role: inv.role },
      });
    }
  }

  return user;
}

function humanRole(role: Role): string {
  return role.toString().replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

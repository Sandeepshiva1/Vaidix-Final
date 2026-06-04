// ════════════════════════════════════════════════════════════════════════════
// GET / PATCH /api/admin/users/[id]
// ════════════════════════════════════════════════════════════════════════════
// GET   — single user detail including profile + recent role-history. Admin-only.
// PATCH — edit identity (name/mobile/username) + profile fields. Admin-only.
//         Role and status have dedicated endpoints (see ./role and ./status)
//         because both write to UserRoleHistory / bump passwordVersion.

import { z } from 'zod';
import {
  jsonOk,
  jsonError,
  requireRole,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import { getUser, updateUserDetails, UserAdminError } from '@/server/services/user-admin-service';
import { cuidSchema, fullNameSchema, mobileSchema, usernameSchema } from '@/lib/validation/primitives';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const user = await getUser(id);
    if (!user) return jsonError('NOT_FOUND', 'User not found', 404);

    // Profile + mobile/username + program-director + cohorts are needed by the
    // edit modal but live on separate models (UserProfile / CohortMember) or
    // unselected columns. One extra query each, all indexed.
    const [profile, identity, memberships] = await Promise.all([
      db.userProfile.findUnique({
        where: { userId: id },
        select: {
          subspecialty: true,
          yearOfResidency: true,
          affiliation: true,
          bio: true,
          timezone: true,
          mciRegNumber: true,
          gender: true,
          languages: true,
        },
      }),
      db.user.findUnique({
        where: { id },
        select: {
          mobile: true,
          username: true,
          programDirectorId: true,
          facultyMentorId: true,
          programDirector: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          facultyMentor: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
      }),
      db.cohortMember.findMany({
        where: { userId: id },
        select: {
          cohort: { select: { id: true, name: true, academicYear: true } },
        },
      }),
    ]);

    return jsonOk({
      user: {
        ...user,
        profile,
        mobile: identity?.mobile ?? null,
        username: identity?.username ?? null,
        programDirectorId: identity?.programDirectorId ?? null,
        programDirector: identity?.programDirector ?? null,
        facultyMentorId: identity?.facultyMentorId ?? null,
        facultyMentor: identity?.facultyMentor ?? null,
        cohorts: memberships.map((m) => m.cohort).filter(Boolean),
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

const profileUpdateSchema = z
  .object({
    subspecialty: z.string().trim().max(120).nullable().optional(),
    yearOfResidency: z.number().int().min(1).max(10).nullable().optional(),
    affiliation: z.string().trim().max(200).nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
    timezone: z.string().trim().max(64).nullable().optional(),
    mciRegNumber: z.string().trim().max(40).nullable().optional(),
    gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).nullable().optional(),
  })
  .strict();

const updateBodySchema = z
  .object({
    name: fullNameSchema.optional(),
    mobile: mobileSchema.nullable().optional(),
    username: usernameSchema.nullable().optional(),
    // Faculty → PD link. Service layer enforces target.role === FACULTY and
    // ref.role === PROGRAM_DIRECTOR. null clears; absent leaves untouched.
    programDirectorId: cuidSchema.nullable().optional(),
    // Resident → faculty mentor link. Service enforces target.role === RESIDENT
    // and ref.role === FACULTY. null clears; absent leaves untouched.
    facultyMentorId: cuidSchema.nullable().optional(),
    // Avatar URL produced by the avatar presign route; the route is the only
    // sanctioned producer (validates content-type + size) so we accept any
    // string here without re-validating shape.
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    // Resident → cohort assignment. Service replaces the user's current
    // cohort memberships with this single cohort. null clears all memberships.
    // Absent leaves untouched. Service enforces target.role === RESIDENT.
    cohortId: cuidSchema.nullable().optional(),
    profile: profileUpdateSchema.optional(),
  })
  .strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const body = await parseBody(req, updateBodySchema);
    if (!body.ok) return body.response;

    const { id } = await ctx.params;

    await updateUserDetails({
      targetUserId: id,
      actorId: gate.user.id,
      data: body.data,
    });

    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof UserAdminError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

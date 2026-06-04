// ════════════════════════════════════════════════════════════════════════════
// Identity mappers — single source of truth for converting Prisma `User`
// records into the lowercase `UserRole` union and the UI-shaped `Identity`
// object consumed by the RoleProvider, sidebar, header, and dashboards.
// ════════════════════════════════════════════════════════════════════════════
//
// Why this module exists:
//   The Prisma schema has Role (UPPERCASE_SNAKE_CASE) + User + UserProfile.
//   The UI layer historically used a hand-rolled `User` type with fields like
//   `designation`, `department`, `yearOfTraining` that DO NOT exist on the
//   real schema. To eliminate the demo-mode RoleProvider while keeping the
//   UI's existing field names, we map here, in one place.
//
// Field mapping (Prisma → UI):
//   role            ← User.role          (lowercased)
//   id/name/email   ← User.id/name/email (passthrough)
//   avatarUrl       ← User.avatarUrl
//   designation     ← derived from ROLE_LABELS[role]      (no DB column)
//   department      ← UserProfile.subspecialty            (free text)
//   yearOfTraining  ← `PGY-${UserProfile.yearOfResidency}` when present
//   specialization  ← UserProfile.subspecialty
//
// Future contributors: if you need a new field on `Identity`, add the column
// to `UserProfile` first, then extend the mapper here. Do NOT add it to the
// session JWT — keep tokens lean.

import { Role as PrismaRole } from '@prisma/client'
import type { User as PrismaUser, UserProfile as PrismaUserProfile } from '@prisma/client'
import { ROLE_LABELS } from '@/lib/constants'
import type { UserRole } from '@/lib/types'

/** Server-side user shape we accept (User joined with optional profile). */
export type UserWithProfile = PrismaUser & {
  profile?: PrismaUserProfile | null
}

/**
 * W6.11 — lightweight membership shape passed to the client. Mirrors
 * SessionProgramMembership in src/types/next-auth.d.ts but uses the lowercase
 * UserRole the UI works in. Kept in `Identity` (not on a separate context)
 * so the existing RoleProvider stays the single source for "who is this and
 * which program are they viewing".
 */
export interface IdentityProgramMembership {
  programId: string
  slug: string
  name: string
  role: UserRole
}

/** UI-facing identity object. Stable shape the RoleContext exposes. */
export interface Identity {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl: string | null
  designation: string
  department: string | null
  yearOfTraining: string | null
  specialization: string | null
  /** W6.11 — programs the user is a member of (active filtered). */
  programs: IdentityProgramMembership[]
  /** W6.11 — currently selected program. Null only for users with zero memberships. */
  activeProgramId: string | null
}

/**
 * Map Prisma's `Role` enum to the lowercase `UserRole` union used by the UI.
 * The mapping is exhaustive — TypeScript will error here if the Prisma enum
 * grows a new variant without a corresponding UI label.
 */
export function mapPrismaRoleToUserRole(role: PrismaRole): UserRole {
  switch (role) {
    case PrismaRole.RESIDENT:
      return 'resident'
    case PrismaRole.FACULTY:
      return 'faculty'
    case PrismaRole.PROGRAM_DIRECTOR:
      return 'program_director'
    case PrismaRole.ADMIN:
      return 'admin'
    case PrismaRole.EXTERNAL_LEARNER:
      return 'external_learner'
  }
}

/**
 * Build the UI `Identity` from a Prisma user row.
 * Pass `{ include: { profile: true } }` when querying so the profile-derived
 * fields populate; without it they fall back to null.
 *
 * `programs` and `activeProgramId` are sourced from the JWT (the (platform)
 * layout reads them off the session and passes them in) — we do NOT re-query
 * memberships here, since the layout already has them.
 */
export function mapUserToIdentity(
  user: UserWithProfile,
  programInfo: { programs: IdentityProgramMembership[]; activeProgramId: string | null } = {
    programs: [],
    activeProgramId: null,
  },
): Identity {
  const role = mapPrismaRoleToUserRole(user.role)
  const profile = user.profile ?? null

  const yearOfTraining =
    profile?.yearOfResidency != null ? `PGY-${profile.yearOfResidency}` : null

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    avatarUrl: user.avatarUrl ?? null,
    // `designation` has no DB column — render the role's display label so the
    // header/dashboard banners always have something meaningful to show.
    designation: ROLE_LABELS[role],
    department: profile?.subspecialty ?? null,
    yearOfTraining,
    specialization: profile?.subspecialty ?? null,
    programs: programInfo.programs,
    activeProgramId: programInfo.activeProgramId,
  }
}

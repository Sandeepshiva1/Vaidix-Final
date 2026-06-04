// ════════════════════════════════════════════════════════════════════════════
// Program Service — W6.11 multi-tenancy
// ════════════════════════════════════════════════════════════════════════════
// Helpers around Program + ProgramMembership. Used by:
//   - auth.ts authorize() to hydrate the JWT at sign-in
//   - POST /api/me/active-program to validate + persist a switch
//   - any service needing the user's active program for query scoping
//
// Server-only. Prisma client is Node runtime.

import { db } from '@/lib/db';
import { ProgramStatus, type Role } from '@prisma/client';
import type { SessionProgramMembership } from '@/types/next-auth';

export class ProgramAccessError extends Error {
  constructor(
    public readonly code: 'NOT_A_MEMBER' | 'PROGRAM_NOT_FOUND' | 'PROGRAM_INACTIVE',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Load a user's active program memberships in the lightweight shape the JWT
 * carries. Filters out ARCHIVED programs so the switcher never offers a stale
 * tenant. Resolves the user's `activeProgramId`, falling back to the first
 * membership when the stored value is null or points at an archived program.
 */
export async function loadProgramsForUser(userId: string): Promise<{
  programs: SessionProgramMembership[];
  activeProgramId: string | null;
}> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, activeProgramId: true },
  });
  if (!user) return { programs: [], activeProgramId: null };

  const memberships = await db.programMembership.findMany({
    where: { userId, program: { status: ProgramStatus.ACTIVE } },
    include: { program: { select: { id: true, slug: true, name: true } } },
    orderBy: { addedAt: 'asc' },
  });

  const programs: SessionProgramMembership[] = memberships.map((m) => ({
    programId: m.programId,
    slug:      m.program.slug,
    name:      m.program.name,
    role:      m.role ?? user.role,
  }));

  // Prefer the stored activeProgramId when it's still valid; otherwise the
  // first membership; null only if the user has no memberships at all.
  const stored = user.activeProgramId;
  const activeProgramId =
    stored && programs.some((p) => p.programId === stored)
      ? stored
      : programs[0]?.programId ?? null;

  return { programs, activeProgramId };
}

/**
 * Switch a user's active program. Validates that the user is actually a member
 * (the source of truth — never trust a client-supplied id), then writes
 * `users.activeProgramId`. Returns the refreshed { programs, activeProgramId }
 * the caller can echo back so the client can `update(...)` the session.
 */
export async function setActiveProgram(
  userId: string,
  programId: string,
): Promise<{ programs: SessionProgramMembership[]; activeProgramId: string }> {
  const program = await db.program.findUnique({
    where: { id: programId },
    select: { id: true, status: true },
  });
  if (!program) throw new ProgramAccessError('PROGRAM_NOT_FOUND', 'Program not found');
  if (program.status !== ProgramStatus.ACTIVE) {
    throw new ProgramAccessError('PROGRAM_INACTIVE', 'Program is archived');
  }

  const membership = await db.programMembership.findUnique({
    where: { userId_programId: { userId, programId } },
    select: { id: true },
  });
  if (!membership) {
    throw new ProgramAccessError('NOT_A_MEMBER', 'You are not a member of this program');
  }

  await db.user.update({
    where: { id: userId },
    data:  { activeProgramId: programId },
  });

  const refreshed = await loadProgramsForUser(userId);
  return {
    programs: refreshed.programs,
    activeProgramId: refreshed.activeProgramId ?? programId,
  };
}

/**
 * Resolve the active programId for the *currently authenticated user* by
 * reading the session JWT. Use this inside service-layer queries to scope
 * lists. Throws if no session — services that can run unauth'd should pass
 * a programId explicitly instead.
 */
export async function getActiveProgramIdFromSession(): Promise<string> {
  const { auth } = await import('@/auth');
  const session = await auth();
  const id = session?.user?.activeProgramId;
  if (!id) {
    throw new ProgramAccessError('NOT_A_MEMBER', 'No active program in session');
  }
  return id;
}

/**
 * Same as above but tolerant — returns null instead of throwing when the
 * session has no active program. For routes that want to render a graceful
 * empty state instead of erroring out (e.g. brand-new accounts pre-onboarding).
 */
export async function tryGetActiveProgramIdFromSession(): Promise<string | null> {
  const { auth } = await import('@/auth');
  const session = await auth();
  return session?.user?.activeProgramId ?? null;
}

/** Used by routes that need the role inside the active program (UI shaping). */
export function pickActiveMembership(
  programs: SessionProgramMembership[],
  activeProgramId: string | null,
): { programId: string; role: Role; name: string; slug: string } | null {
  if (!activeProgramId) return null;
  const found = programs.find((p) => p.programId === activeProgramId);
  return found ? { programId: found.programId, role: found.role, name: found.name, slug: found.slug } : null;
}

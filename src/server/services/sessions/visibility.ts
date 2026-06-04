// ════════════════════════════════════════════════════════════════════════════
// Session visibility helpers — shared across W6.8 services
// ════════════════════════════════════════════════════════════════════════════
// Audience model: each TeachingSession carries three independent flags, set in
// any combination at create-time:
//   openToAll  — anyone with the share-link can join the live call + chat
//   cohortId   — cohort members get list visibility + materials access
//   invites[]  — listed invitees get list visibility + materials access
//
// List-surface visibility (Classroom feed / Calendar / Dashboard upcoming /
// iCal feed) is driven by cohort membership and invite presence ONLY.
// `openToAll` alone does not auto-list a session in anyone's feed — those
// sessions are link-joinable but invisible until the host shares the URL.
// This stops the OPEN_TO_ALL footgun where a default-checked option silently
// inserted a session into every user's calendar.

import { db } from '@/lib/db';
import { Role, SessionApprovalStatus, type Prisma } from '@prisma/client';
import { getUserCohortIds } from '../cohort-service';

export interface SessionVisibilityActor {
  userId: string;
  role: Role;
  /**
   * W6.11 — actor's currently active program. Optional for backwards-compat
   * during the W6.11 rollout: the listing entry-point routes (classroom,
   * calendar, dashboard upcoming) MUST pass it so admins/PDs are scoped to
   * their active tenant; deeper paths (visibility checks on a known sessionId)
   * tolerate omission since the session id is the security boundary there.
   *
   * Once every caller passes it (Phase-2 audit), the optional marker drops.
   */
  activeProgramId?: string;
}

/**
 * W6.11 — build the program-scoping fragment. Returns an empty fragment if
 * the actor has no active program (defensive — should not happen in
 * authenticated requests because requireAuthWithProgram fails first).
 */
export function buildProgramScope(actor: SessionVisibilityActor): Prisma.TeachingSessionWhereInput {
  return actor.activeProgramId ? { programId: actor.activeProgramId } : {};
}

/**
 * Build a Prisma `TeachingSessionWhereInput` fragment encoding "which sessions
 * is this actor allowed to see in their calendar/listing surfaces". Caller
 * composes it into a wider query (time window, approval status, search, etc.).
 *
 *   - ADMIN / PROGRAM_DIRECTOR — program-scope only (full access within tenant)
 *   - Everyone else — cohort-member OR invited OR host OR proposer (within tenant)
 *
 * `openToAll` is intentionally NOT a list-surface match: those sessions are
 * link-shareable (anyone with the URL can join via `userCanSeeSession` below)
 * but should not auto-populate every user's calendar. The detail-page check
 * still admits them so a shared link works.
 *
 * The returned fragment is meant to be composed under AND with `buildProgramScope`.
 */
export async function buildSessionVisibilityWhere(
  actor: SessionVisibilityActor
): Promise<Prisma.TeachingSessionWhereInput> {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) {
    return {};
  }

  const cohortIds = await getUserCohortIds(actor.userId);

  // Hosts and proposers always see their own sessions, irrespective of role.
  // Previously this was FACULTY-only, which hid resident/fellow-scheduled
  // sessions from their own calendar + Replays (QA #1, #15).
  return {
    OR: [
      { hostId: actor.userId },
      { proposedBy: actor.userId },
      { cohortId: { in: cohortIds } },
      { invites: { some: { userId: actor.userId } } },
    ],
  };
}

/**
 * Build the approval-status gate for session listings.
 *
 *   - ADMIN / PROGRAM_DIRECTOR — `{}` (see all approval states; they need
 *     drafts + pending visible to act on them).
 *   - Everyone else — APPROVED only, OR sessions where they are the host or
 *     proposer (so users see their own pending sessions and can act on them).
 *
 * Returns `{}` (a no-op fragment) for privileged roles so callers can
 * unconditionally compose under `AND`. Always compose under `AND`, never
 * spread at the top level — non-privileged returns an `OR` key that will
 * collide with other top-level OR clauses (e.g. visibility, time-window).
 */
export function buildApprovalGate(actor: SessionVisibilityActor): Prisma.TeachingSessionWhereInput {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) {
    return {};
  }
  return {
    OR: [
      { approvalStatus: SessionApprovalStatus.APPROVED },
      { hostId: actor.userId },
      { proposedBy: actor.userId },
    ],
  };
}

/**
 * Visibility check matching the calendar-listing rules:
 *   - ADMIN / PROGRAM_DIRECTOR see everything
 *   - Host or proposer of the session sees it
 *   - Cohort members see it (if cohortId is set and they're a member)
 *   - Invitees see it
 *   - openToAll sessions are visible to anyone logged in (link-share semantics)
 *   - FACULTY role acts as a fallback "can see anything" for review purposes
 */
export async function userCanSeeSession(
  actor: SessionVisibilityActor,
  sessionId: string
): Promise<boolean> {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) return true;
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      hostId: true,
      proposedBy: true,
      openToAll: true,
      cohortId: true,
      invites: { where: { userId: actor.userId }, select: { userId: true } },
    },
  });
  if (!session) return false;
  if (session.hostId === actor.userId || session.proposedBy === actor.userId) return true;
  if (session.openToAll) return true;
  if (session.cohortId) {
    const member = await db.cohortMember.findUnique({
      where: { cohortId_userId: { cohortId: session.cohortId, userId: actor.userId } },
      select: { userId: true },
    });
    if (member) return true;
  }
  if (session.invites.length > 0) return true;
  return actor.role === Role.FACULTY;
}

/** Host of the session, or PD/Admin. Used for curator endpoints (study-pack
 *  curation, pre-case attachment, readiness viewing). */
export async function userIsHostOrPrivileged(
  actor: SessionVisibilityActor,
  sessionId: string
): Promise<boolean> {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) return true;
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  return !!session && session.hostId === actor.userId;
}

/** Compute the canonical learner roster for a session. Used by the readiness
 *  predictor to decide whose readiness to score. Order:
 *  1. invites present  → the invitees
 *  2. cohort set       → the cohort members (residents only)
 *  3. openToAll        → all RESIDENT users in the institution (capped)
 *  4. otherwise        → empty (host-only / private session)
 *  Always excludes the host + proposer (they're presenters, not learners). */
export async function listSessionLearners(sessionId: string): Promise<Array<{
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}>> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      hostId: true,
      proposedBy: true,
      openToAll: true,
      cohortId: true,
      _count: { select: { invites: true } },
    },
  });
  if (!session) return [];
  const exclude = new Set([session.hostId, session.proposedBy]);

  if (session._count.invites > 0) {
    const invites = await db.sessionInvite.findMany({
      where: { sessionId },
      select: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
      },
    });
    return invites
      .map((i) => i.user)
      .filter((u) => !exclude.has(u.id))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }));
  }

  if (session.cohortId) {
    const members = await db.cohortMember.findMany({
      where: { cohortId: session.cohortId },
      select: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
      },
    });
    return members
      .map((m) => m.user)
      .filter((u) => !exclude.has(u.id) && u.role === Role.RESIDENT)
      .map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }));
  }

  if (session.openToAll) {
    // LVPEI cohorts are hundreds, not thousands; if this becomes a perf issue
    // we'll add a hard cap + UI pager.
    const residents = await db.user.findMany({
      where: { role: Role.RESIDENT, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return residents.filter((u) => !exclude.has(u.id));
  }

  return [];
}

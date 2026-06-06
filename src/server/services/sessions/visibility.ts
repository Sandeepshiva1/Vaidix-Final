// ════════════════════════════════════════════════════════════════════════════
// Session visibility helpers — shared across services
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
   * actor's currently active program. Optional for backwards-compat
   * during the rollout: the listing entry-point routes (classroom,
   * calendar, dashboard upcoming) MUST pass it so admins/PDs are scoped to
   * their active tenant; deeper paths (visibility checks on a known sessionId)
   * tolerate omission since the session id is the security boundary there.
   *
   * Once every caller passes it (Phase-2 audit), the optional marker drops.
   */
  activeProgramId?: string;
}

/**
 * build the program-scoping fragment. Returns an empty fragment if
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

/** A learner on the analytics/readiness roster. */
export interface SessionLearner {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** SessionParticipant.role values that denote a presenter, not a learner. */
const PRESENTER_PARTICIPANT_ROLES = ['HOST', 'CO_HOST'];
/** User roles that count as learners when auto-derived from live attendance. */
const LEARNER_USER_ROLES: Role[] = [Role.RESIDENT, Role.EXTERNAL_LEARNER];

/** Compute the canonical learner roster for a session. Used by the readiness
 *  predictor + responses/analytics to decide whose readiness to score.
 *
 *  The roster is the UNION of everyone expected to engage AND everyone who
 *  actually did, so the analytics never under-count a session that was joined
 *  outside its formal invite list:
 *
 *  1. invitees           — explicitly invited to engage (any learner role)
 *  2. cohort members     — when a cohort is attached (residents only)
 *  3. live participants  — anyone who actually joined as a learner
 *                          (excludes HOST/CO_HOST seats + non-learner roles)
 *  4. openToAll fallback — only when the union above is empty: all RESIDENT
 *                          users in the institution (capped), so an open
 *                          session still shows an expected audience pre-join.
 *
 *  Always excludes the host + proposer (they're presenters, not learners) and
 *  de-duplicates a user who appears via more than one path (e.g. invited AND
 *  attended). Previously this was a priority cascade that returned ONLY the
 *  first matching source, so a session joined by a learner who wasn't on the
 *  invite list (or had no cohort) scored an empty cohort — every readiness /
 *  leaderboard / distribution number came back 0 despite live attendance. */
export async function listSessionLearners(sessionId: string): Promise<SessionLearner[]> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      hostId: true,
      proposedBy: true,
      openToAll: true,
      cohortId: true,
    },
  });
  if (!session) return [];
  const exclude = new Set([session.hostId, session.proposedBy]);

  // Insertion-ordered de-dupe: invitees first, then cohort, then attendees.
  const roster = new Map<string, SessionLearner>();
  const add = (u: { id: string; name: string; email: string; avatarUrl: string | null }) => {
    if (exclude.has(u.id) || roster.has(u.id)) return;
    roster.set(u.id, { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl });
  };

  const [invites, cohortMembers, participants] = await Promise.all([
    // 1. Explicit invitees — host invited them deliberately, so any role counts.
    db.sessionInvite.findMany({
      where: { sessionId },
      select: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } },
    }),
    // 2. Cohort members (residents only) — only queried when a cohort is set.
    session.cohortId
      ? db.cohortMember.findMany({
          where: { cohortId: session.cohortId },
          select: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } },
        })
      : Promise.resolve([] as Array<{ user: { id: string; name: string; email: string; avatarUrl: string | null; role: Role } }>),
    // 3. Live attendees who joined as learners (not in a presenter seat).
    db.sessionParticipant.findMany({
      where: { sessionId, role: { notIn: PRESENTER_PARTICIPANT_ROLES } },
      select: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } },
    }),
  ]);

  for (const i of invites) add(i.user);
  for (const m of cohortMembers) if (m.user.role === Role.RESIDENT) add(m.user);
  for (const p of participants) if (LEARNER_USER_ROLES.includes(p.user.role)) add(p.user);

  if (roster.size > 0) return [...roster.values()];

  // 4. Nothing concrete yet — an open session still has an expected audience.
  if (session.openToAll) {
    // LVPEI cohorts are hundreds, not thousands; if this becomes a perf issue
    // we'll add a hard cap + UI pager.
    const residents = await db.user.findMany({
      where: { role: Role.RESIDENT, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    for (const u of residents) add(u);
  }

  return [...roster.values()];
}

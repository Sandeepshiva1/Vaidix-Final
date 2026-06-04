// ════════════════════════════════════════════════════════════════════════════
// Session Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Teaching session lifecycle: create/draft, submit for approval, approve/reject,
// reschedule, cancel. Conflict checks, recurrence expansion, invite management.

import { randomBytes, randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { audit } from './audit';
import { sessionAudit, SESSION_AUDIT } from './session-audit';
import { getUserCohortIds } from './cohort-service';
import {
  notifySessionProposed,
  notifySessionApproved,
  notifySessionRejected,
  notifySessionRescheduled,
  notifySessionCancelled,
  notifySessionStarted,
  notifySessionEnded,
} from './session-notifications';
import {
  scheduleSessionReminders,
  cancelSessionReminders,
} from './reminder-scheduler';
import {
  SessionApprovalStatus,
  SessionApprovalAction,
  SessionStatus,
  Role,
  Prisma,
} from '@prisma/client';
import type {
  CreateSessionInput,
  RescheduleInput,
  UpdateSessionInput,
  ObjectiveInput,
} from '@/lib/validation/session';
import { isInScheduledWindow } from '@/lib/sessions/scheduled-window';

// Stamps a server-generated id on every objective lacking one. Curators can
// reorder freely on the client; the id is what resident achievements key on.
export function normaliseObjectives(input: ObjectiveInput[] | null | undefined) {
  if (!input || input.length === 0) return null;
  return input.map((o) => ({
    id: o.id ?? randomUUID(),
    text: o.text.trim(),
    blooms: o.blooms,
    epaTag: o.epaTag ?? null,
  }));
}

// Runs async side effects without letting their errors surface to the caller.
// Lifecycle transitions must not roll back when a downstream email or queue
// job fails.
function runSideEffects(task: Promise<unknown>, label: string): void {
  task.catch((err) => {
    console.error(`[session-service] side-effect failed: ${label}`, err);
  });
}

// ----------------------------------------------------------------------------
// Conflict detection — application-layer. The Postgres EXCLUDE USING GIST
// constraint is the race-free backstop; this gives human-readable errors first.
// ----------------------------------------------------------------------------
export async function findHostConflicts(opts: {
  hostId: string;
  start: Date;
  end: Date;
  excludeSessionId?: string;
}) {
  return db.teachingSession.findMany({
    where: {
      hostId: opts.hostId,
      approvalStatus: SessionApprovalStatus.APPROVED,
      status: { in: [SessionStatus.SCHEDULED, SessionStatus.LIVE] },
      deletedAt: null,
      id: opts.excludeSessionId ? { not: opts.excludeSessionId } : undefined,
      // Two ranges overlap iff start1 < end2 AND end1 > start2
      scheduledStart: { lt: opts.end },
      scheduledEnd: { gt: opts.start },
    },
    select: {
      id: true,
      title: true,
      scheduledStart: true,
      scheduledEnd: true,
    },
  });
}

// ----------------------------------------------------------------------------
// Create session (PD drafts)
// Auto-approve when the proposer is also the host.
// ----------------------------------------------------------------------------
export async function createSession(
  input: CreateSessionInput,
  proposedBy: string,
  proposerRole: Role,
  programId: string,
) {
  const start = new Date(input.scheduledStart);
  const end = new Date(input.scheduledEnd);

  // FACULTY / PD / ADMIN / RESIDENT may propose. Host rules:
  //   • FACULTY / PD / ADMIN host — anyone above may propose (faculty hosting
  //     themselves auto-approves; resident-proposed goes to PENDING_FACULTY).
  //   • RESIDENT host — only allowed when proposer == host (peer-led journal
  //     club / case presentation), and auto-approves. A resident cannot
  //     schedule a session *for* another resident — there is no faculty
  //     approver in that path.
  if (
    proposerRole !== Role.FACULTY &&
    proposerRole !== Role.PROGRAM_DIRECTOR &&
    proposerRole !== Role.ADMIN &&
    proposerRole !== Role.RESIDENT
  ) {
    throw new Error('FORBIDDEN_PROPOSER_ROLE');
  }

  const host = await db.user.findUnique({
    where: { id: input.hostId },
    select: { id: true, role: true, status: true, name: true, email: true },
  });
  if (!host || host.status !== 'ACTIVE') throw new Error('HOST_NOT_FOUND');
  const hostIsStaff =
    host.role === Role.FACULTY ||
    host.role === Role.PROGRAM_DIRECTOR ||
    host.role === Role.ADMIN;
  const hostIsSelfResident = host.role === Role.RESIDENT && host.id === proposedBy;
  if (!hostIsStaff && !hostIsSelfResident) {
    throw new Error('HOST_NOT_FACULTY');
  }

  // W6.11 — cohort must belong to the same program; defense-in-depth against
  // a PD with two memberships submitting a Cornea cohort id while active in MS.
  if (input.cohortId) {
    const cohort = await db.cohort.findUnique({
      where: { id: input.cohortId },
      select: { id: true, programId: true },
    });
    if (!cohort) throw new Error('COHORT_NOT_FOUND');
    if (cohort.programId !== programId) throw new Error('COHORT_PROGRAM_MISMATCH');
  }

  // Auto-approve when proposer == host
  const autoApprove = proposedBy === input.hostId;
  const approvalStatus = autoApprove ? SessionApprovalStatus.APPROVED : SessionApprovalStatus.PENDING_FACULTY;

  // Detect overlapping APPROVED sessions on this host's calendar so we can
  // warn the proposer (Teams-style). Non-blocking: with the DB exclusion
  // constraint dropped (migration 20260509150000), we let the schedule
  // through and surface the conflict in the response.
  const hostConflicts = await findHostConflicts({ hostId: input.hostId, start, end });

  const session = await db.$transaction(async (tx) => {
    const created = await tx.teachingSession.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        sessionType: input.sessionType,
        hostId: input.hostId,
        proposedBy,
        programId,
        status: SessionStatus.SCHEDULED,
        approvalStatus,
        approvedBy: autoApprove ? proposedBy : null,
        approvedAt: autoApprove ? new Date() : null,
        openToAll: input.openToAll,
        cohortId: input.cohortId ?? null,
        scheduledStart: start,
        scheduledEnd: end,
        recurrenceRule: input.recurrenceRule ?? null,
        recurrenceUntil: input.recurrenceUntil ? new Date(input.recurrenceUntil) : null,
        maxParticipants: input.maxParticipants,
        recordingEnabled: input.recordingEnabled,
        consentRequired: input.consentRequired,
        topicId: input.topicId ?? null,
        tags: input.tags,
        objectives: normaliseObjectives(input.objectives) ?? Prisma.JsonNull,
        // Metadata bag for session features that aren't queried from SQL:
        // prereq config + recurrence exception list (Teams-style "skip these
        // dates" — the RRULE itself doesn't carry exclusions).
        metadata: (() => {
          const m: Record<string, unknown> = {};
          if (input.prereq) m.prereq = input.prereq;
          if (input.excludedDates?.length) m.excludedDates = input.excludedDates;
          if (input.captionsProfile) m.captionsProfile = input.captionsProfile;
          return Object.keys(m).length > 0 ? (m as Prisma.InputJsonValue) : Prisma.JsonNull;
        })(),
      },
    });

    // Invitees — orthogonal to openToAll/cohort; the host can mix them.
    if (input.inviteeIds?.length) {
      await tx.sessionInvite.createMany({
        data: input.inviteeIds.map((userId) => ({
          sessionId: created.id,
          userId,
          invitedBy: proposedBy,
        })),
        skipDuplicates: true,
      });
    }

    await tx.sessionApprovalAudit.create({
      data: {
        sessionId: created.id,
        actorId: proposedBy,
        action: autoApprove ? SessionApprovalAction.AUTO_APPROVED : SessionApprovalAction.PROPOSED,
      },
    });

    return created;
  });

  await audit({
    actorId: proposedBy,
    eventType: autoApprove ? 'SESSION_AUTO_APPROVED' : 'SESSION_PROPOSED',
    entityType: 'teaching_session',
    entityId: session.id,
    summary: `${autoApprove ? 'Auto-approved' : 'Proposed'} session "${session.title}"`,
  });

  if (autoApprove) {
    // Auto-approved (PD hosting own session) — skip proposal email, go straight
    // to attendee notifications + reminders.
    runSideEffects(notifySessionApproved(session.id), 'notify auto-approved');
    runSideEffects(scheduleSessionReminders(session.id), 'schedule reminders (auto-approved)');
  } else {
    runSideEffects(notifySessionProposed(session.id), 'notify proposed');
  }

  return { session, hostConflicts };
}

// ----------------------------------------------------------------------------
// Approval flow
// ----------------------------------------------------------------------------
export async function approveSession(sessionId: string, actorId: string, actorRole: Role) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      hostId: true,
      approvalStatus: true,
      scheduledStart: true,
      scheduledEnd: true,
      title: true,
    },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.approvalStatus !== SessionApprovalStatus.PENDING_FACULTY) {
    throw new Error('NOT_PENDING');
  }
  // Only the designated host (or an admin) can approve
  if (session.hostId !== actorId && actorRole !== Role.ADMIN) {
    throw new Error('NOT_DESIGNATED_HOST');
  }

  // Detect overlap (warning only — DB constraint was dropped in migration
  // 20260509150000 to permit Teams-style overlapping schedules). The caller
  // surfaces this back to the approver so they can choose to cancel one of
  // the conflicting sessions afterwards.
  const hostConflicts = await findHostConflicts({
    hostId: session.hostId,
    start: session.scheduledStart,
    end: session.scheduledEnd,
    excludeSessionId: sessionId,
  });

  await db.$transaction([
    db.teachingSession.update({
      where: { id: sessionId },
      data: {
        approvalStatus: SessionApprovalStatus.APPROVED,
        approvedBy: actorId,
        approvedAt: new Date(),
      },
    }),
    db.sessionApprovalAudit.create({
      data: { sessionId, actorId, action: SessionApprovalAction.APPROVED },
    }),
  ]);

  await audit({
    actorId,
    eventType: 'SESSION_APPROVED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Approved "${session.title}"`,
  });

  runSideEffects(notifySessionApproved(sessionId), 'notify approved');
  runSideEffects(scheduleSessionReminders(sessionId), 'schedule reminders (approved)');

  const updated = await db.teachingSession.findUniqueOrThrow({ where: { id: sessionId } });
  return { session: updated, hostConflicts };
}

export async function rejectSession(sessionId: string, actorId: string, actorRole: Role, reason: string) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true, approvalStatus: true, title: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.approvalStatus !== SessionApprovalStatus.PENDING_FACULTY) throw new Error('NOT_PENDING');
  if (session.hostId !== actorId && actorRole !== Role.ADMIN) throw new Error('NOT_DESIGNATED_HOST');

  await db.$transaction([
    db.teachingSession.update({
      where: { id: sessionId },
      data: {
        approvalStatus: SessionApprovalStatus.REJECTED,
        rejectedReason: reason,
      },
    }),
    db.sessionApprovalAudit.create({
      data: { sessionId, actorId, action: SessionApprovalAction.REJECTED, reason },
    }),
  ]);

  await audit({
    actorId,
    eventType: 'SESSION_REJECTED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Rejected "${session.title}": ${reason}`,
  });

  runSideEffects(notifySessionRejected(sessionId, reason), 'notify rejected');

  return db.teachingSession.findUniqueOrThrow({ where: { id: sessionId } });
}

// ----------------------------------------------------------------------------
// Reschedule — reverts approved session to PENDING_FACULTY
// ----------------------------------------------------------------------------
export async function rescheduleSession(
  sessionId: string,
  actorId: string,
  actorRole: Role,
  input: RescheduleInput
) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      proposedBy: true,
      hostId: true,
      approvalStatus: true,
      title: true,
      scheduledStart: true,
      scheduledEnd: true,
    },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  // Host of the session may also reschedule their own slot — the edit-session
  // form surfaces date/time edits for hosts, and refusing them here forces an
  // awkward "ask the original proposer to move it" round-trip. Auto-approve
  // logic below already short-circuits for the host case.
  if (
    session.proposedBy !== actorId &&
    session.hostId !== actorId &&
    actorRole !== Role.ADMIN
  ) {
    throw new Error('NOT_PROPOSER');
  }
  if (session.approvalStatus === SessionApprovalStatus.CANCELLED) throw new Error('ALREADY_CANCELLED');

  const start = new Date(input.scheduledStart);
  const end = new Date(input.scheduledEnd);
  const autoApprove = actorId === session.hostId;
  const previousStart = session.scheduledStart;
  const previousEnd = session.scheduledEnd;

  // Warning-only host conflict detection at the new slot — same Teams-style
  // contract as createSession/approveSession.
  const hostConflicts = await findHostConflicts({
    hostId: session.hostId,
    start,
    end,
    excludeSessionId: sessionId,
  });

  await db.$transaction([
    db.teachingSession.update({
      where: { id: sessionId },
      data: {
        scheduledStart: start,
        scheduledEnd: end,
        approvalStatus: autoApprove ? SessionApprovalStatus.APPROVED : SessionApprovalStatus.PENDING_FACULTY,
        approvedBy: autoApprove ? actorId : null,
        approvedAt: autoApprove ? new Date() : null,
        rejectedReason: null,
      },
    }),
    db.sessionApprovalAudit.create({
      data: {
        sessionId,
        actorId,
        action: SessionApprovalAction.RESCHEDULED,
        reason: input.reason ?? null,
      },
    }),
  ]);

  await audit({
    actorId,
    eventType: 'SESSION_RESCHEDULED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Rescheduled "${session.title}"`,
  });

  // Drain stale reminder jobs; re-schedule only if the session is still approved.
  runSideEffects(cancelSessionReminders(sessionId), 'cancel stale reminders');
  runSideEffects(
    notifySessionRescheduled(
      sessionId,
      { start: previousStart, end: previousEnd },
      !autoApprove,
    ),
    'notify rescheduled'
  );
  if (autoApprove) {
    runSideEffects(scheduleSessionReminders(sessionId), 'schedule reminders (rescheduled)');
  }

  const updated = await db.teachingSession.findUniqueOrThrow({ where: { id: sessionId } });
  return { session: updated, hostConflicts };
}

// ----------------------------------------------------------------------------
// Cancel session (soft cancel — status only)
// ----------------------------------------------------------------------------
export async function cancelSession(
  sessionId: string,
  actorId: string,
  actorRole: Role,
  reason?: string
) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, proposedBy: true, hostId: true, title: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (
    session.proposedBy !== actorId &&
    session.hostId !== actorId &&
    actorRole !== Role.ADMIN
  ) {
    throw new Error('NOT_AUTHORIZED');
  }

  await db.$transaction([
    db.teachingSession.update({
      where: { id: sessionId },
      data: {
        approvalStatus: SessionApprovalStatus.CANCELLED,
        status: SessionStatus.CANCELLED,
      },
    }),
    db.sessionApprovalAudit.create({
      data: { sessionId, actorId, action: SessionApprovalAction.CANCELLED, reason: reason ?? null },
    }),
  ]);

  await audit({
    actorId,
    eventType: 'SESSION_CANCELLED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Cancelled "${session.title}"`,
  });

  runSideEffects(cancelSessionReminders(sessionId), 'cancel reminders (cancelled)');
  runSideEffects(notifySessionCancelled(sessionId, reason), 'notify cancelled');
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------
export async function getSession(id: string) {
  return db.teachingSession.findUnique({
    where: { id },
    include: {
      host: { select: { id: true, name: true, email: true, role: true } },
      proposer: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      cohort: { select: { id: true, name: true } },
      invites: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      approvalAudits: {
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { participants: true } },
    },
  });
}

// ----------------------------------------------------------------------------
// W2 — Live room helpers
// ----------------------------------------------------------------------------

/**
 * Returns the effective LiveKit role for a user in a session.
 * HOST: user is the designated host.
 * CO_HOST: user has a SessionParticipant row with role=CO_HOST (host-promoted).
 * PARTICIPANT: user passes visibility rules.
 * VIEWER: null = cannot join (caller must also check admission flow).
 */
export async function getEffectiveSessionRole(
  sessionId: string,
  userId: string,
  userRole: Role
): Promise<'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER' | null> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      hostId: true,
      proposedBy: true,
      openToAll: true,
      cohortId: true,
      approvalStatus: true,
    },
  });
  if (!session) return null;
  if (session.approvalStatus !== SessionApprovalStatus.APPROVED) return null;

  if (session.hostId === userId) return 'HOST';

  // Admin audits as viewer (no publish) unless they are host
  if (userRole === Role.ADMIN) return 'VIEWER';

  // Check co-host designation in SessionParticipant
  const part = await db.sessionParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { role: true },
  });
  if (part?.role === 'CO_HOST') return 'CO_HOST';

  // Audience checks — any match grants PARTICIPANT. Order is cheapest-first
  // (cohort lookup hits an index; invite is a single-row by-pk read).
  if (session.cohortId) {
    const myCohorts = await getUserCohortIds(userId);
    if (myCohorts.includes(session.cohortId)) return 'PARTICIPANT';
  }

  const invite = await db.sessionInvite.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { id: true },
  });
  if (invite) return 'PARTICIPANT';

  // openToAll = anyone-with-link can join. Granted last so cohort/invite take
  // precedence (no functional difference for PARTICIPANT, but keeps the
  // mental model "explicit audience first, public fallback last").
  if (session.openToAll) return 'PARTICIPANT';

  // PD who proposed the session — treat as viewer (auditing role, not host)
  if (session.proposedBy === userId) return 'VIEWER';

  return null;
}

/**
 * Flip session status SCHEDULED → LIVE *only when `now` is inside the
 * session's scheduled window* (see `isInScheduledWindow`). Returns whether
 * the flip happened — callers use that signal to gate side-effects like
 * starting the recording egress.
 *
 * Why a shared helper: the same flip-and-record decision is needed from at
 * least three places — `recordParticipantJoin`, the LiveKit `room_started`
 * webhook, and the `participant_joined` webhook (which catches the case
 * where a host pre-flighted the room and the window opened while they were
 * waiting). Centralising it ensures all three honour the same window rule.
 *
 * Recurring: a recurring session whose master row is ENDED from a prior
 * occurrence is also flipped back to LIVE if `now` is inside the *next*
 * occurrence's window. Without this, only the first occurrence of a series
 * would ever go LIVE — every subsequent occurrence would silently stay in
 * pre-flight mode because the where clause kept rejecting ENDED rows.
 */
export async function maybeFlipToLive(
  sessionId: string,
  actorId: string | null,
  now: Date = new Date(),
): Promise<{ flipped: boolean; reason: 'NOT_FOUND' | 'ALREADY_LIVE' | 'OUT_OF_WINDOW' | 'WRONG_STATUS' | 'CANCELLED' | 'FLIPPED' }> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      recurrenceRule: true,
      recurrenceUntil: true,
      deletedAt: true,
    },
  });
  if (!session || session.deletedAt) return { flipped: false, reason: 'NOT_FOUND' };
  if (session.status === SessionStatus.LIVE) return { flipped: false, reason: 'ALREADY_LIVE' };
  if (session.status === SessionStatus.CANCELLED) return { flipped: false, reason: 'CANCELLED' };
  if (!isInScheduledWindow(session, now)) return { flipped: false, reason: 'OUT_OF_WINDOW' };

  // SCHEDULED → LIVE always; ENDED → LIVE only for recurring (next occurrence).
  const allowFromEnded = !!session.recurrenceRule;
  const allowedFrom: SessionStatus[] = allowFromEnded
    ? [SessionStatus.SCHEDULED, SessionStatus.ENDED]
    : [SessionStatus.SCHEDULED];

  const updated = await db.teachingSession.updateMany({
    where: { id: sessionId, status: { in: allowedFrom } },
    data: {
      status: SessionStatus.LIVE,
      actualStart: now,
      // Reset actualEnd so the previous occurrence's end-stamp doesn't carry
      // over into the new live row. Only matters for recurring sessions.
      ...(allowFromEnded ? { actualEnd: null } : {}),
    },
  });
  if (updated.count === 0) return { flipped: false, reason: 'WRONG_STATUS' };

  await sessionAudit({
    sessionId,
    eventType: SESSION_AUDIT.SESSION_STARTED,
    actorId,
  });
  // Fire-and-forget in-app notification to host + attendees.
  runSideEffects(notifySessionStarted(sessionId), 'notify started');
  return { flipped: true, reason: 'FLIPPED' };
}

/**
 * Upserts a SessionParticipant row when a user enters the LiveKit room.
 * Returns whether the join also triggered a SCHEDULED→LIVE flip — webhook
 * caller uses that to decide whether to kick off recording egress.
 *
 * The flip happens on *any* role join (not just host), because the host may
 * already be in the room (pre-flight) when a participant arrives at the
 * start time and triggers the window check. Host-only would miss that.
 */
export async function recordParticipantJoin(args: {
  sessionId: string;
  userId: string;
  livekitIdentity: string;
  role: 'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER';
}): Promise<{ flippedToLive: boolean }> {
  await db.sessionParticipant.upsert({
    where: { sessionId_userId: { sessionId: args.sessionId, userId: args.userId } },
    create: {
      sessionId: args.sessionId,
      userId: args.userId,
      role: args.role,
      livekitIdentity: args.livekitIdentity,
      joinedAt: new Date(),
    },
    update: {
      role: args.role,
      livekitIdentity: args.livekitIdentity,
      joinedAt: new Date(),
      leftAt: null,
    },
  });

  const flip = await maybeFlipToLive(args.sessionId, args.userId);

  await sessionAudit({
    sessionId: args.sessionId,
    eventType: SESSION_AUDIT.PARTICIPANT_JOINED,
    actorId: args.userId,
    targetUserId: args.userId,
    details: { role: args.role, preflight: flip.reason === 'OUT_OF_WINDOW' },
  });

  return { flippedToLive: flip.flipped };
}

export async function recordParticipantLeave(args: {
  sessionId: string;
  userId: string;
}) {
  await db.sessionParticipant.updateMany({
    where: { sessionId: args.sessionId, userId: args.userId, leftAt: null },
    data: { leftAt: new Date() },
  });
  await sessionAudit({
    sessionId: args.sessionId,
    eventType: SESSION_AUDIT.PARTICIPANT_LEFT,
    actorId: args.userId,
    targetUserId: args.userId,
  });
}

export async function endSession(sessionId: string, actorId: string, actorRole: Role) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, title: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.hostId !== actorId && actorRole !== Role.ADMIN) throw new Error('NOT_HOST');

  await db.teachingSession.update({
    where: { id: sessionId },
    data: {
      status: SessionStatus.ENDED,
      actualEnd: new Date(),
    },
  });
  await audit({
    actorId,
    eventType: 'SESSION_ENDED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Ended "${session.title}"`,
  });
  await sessionAudit({
    sessionId,
    eventType: SESSION_AUDIT.SESSION_ENDED,
    actorId,
  });
  // Fire-and-forget in-app notification to host + attendees so the inbox
  // surfaces a "recording available shortly" row.
  runSideEffects(notifySessionEnded(sessionId), 'notify ended');
}

export async function promoteToCoHost(
  sessionId: string,
  targetUserId: string,
  actorId: string,
  actorRole: Role
) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.hostId !== actorId && actorRole !== Role.ADMIN) throw new Error('NOT_HOST');

  await db.sessionParticipant.upsert({
    where: { sessionId_userId: { sessionId, userId: targetUserId } },
    create: { sessionId, userId: targetUserId, role: 'CO_HOST' },
    update: { role: 'CO_HOST' },
  });
  await audit({
    actorId,
    eventType: 'SESSION_COHOST_PROMOTED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Promoted ${targetUserId} to co-host`,
  });
  await sessionAudit({
    sessionId,
    eventType: SESSION_AUDIT.COHOST_PROMOTED,
    actorId,
    targetUserId,
  });
}

export async function demoteFromCoHost(
  sessionId: string,
  targetUserId: string,
  actorId: string,
  actorRole: Role
) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.hostId !== actorId && actorRole !== Role.ADMIN) throw new Error('NOT_HOST');

  await db.sessionParticipant.updateMany({
    where: { sessionId, userId: targetUserId, role: 'CO_HOST' },
    data: { role: 'PARTICIPANT' },
  });
  await audit({
    actorId,
    eventType: 'SESSION_COHOST_DEMOTED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Demoted ${targetUserId} from co-host`,
  });
  await sessionAudit({
    sessionId,
    eventType: SESSION_AUDIT.COHOST_DEMOTED,
    actorId,
    targetUserId,
  });
}

/**
 * Generate (or refresh) a share token for a session. Only host or proposer
 * may call. Default TTL = 24 hours, capped at 7 days.
 */
export async function generateShareToken(
  sessionId: string,
  actorId: string,
  actorRole: Role,
  ttlHours = 24
) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, proposedBy: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (
    session.hostId !== actorId &&
    session.proposedBy !== actorId &&
    actorRole !== Role.ADMIN
  ) {
    throw new Error('NOT_AUTHORIZED');
  }

  const hours = Math.min(Math.max(1, ttlHours), 24 * 7);
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

  await db.teachingSession.update({
    where: { id: sessionId },
    data: { shareToken: token, shareTokenExpiresAt: expiresAt },
  });
  return { token, expiresAt };
}

export async function revokeShareToken(
  sessionId: string,
  actorId: string,
  actorRole: Role
) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, proposedBy: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (
    session.hostId !== actorId &&
    session.proposedBy !== actorId &&
    actorRole !== Role.ADMIN
  ) {
    throw new Error('NOT_AUTHORIZED');
  }
  await db.teachingSession.update({
    where: { id: sessionId },
    data: { shareToken: null, shareTokenExpiresAt: null },
  });
}

export async function verifyShareToken(sessionId: string, token: string): Promise<boolean> {
  const s = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { shareToken: true, shareTokenExpiresAt: true },
  });
  if (!s?.shareToken || s.shareToken !== token) return false;
  if (s.shareTokenExpiresAt && s.shareTokenExpiresAt < new Date()) return false;
  return true;
}

export async function updateSession(
  sessionId: string,
  actorId: string,
  actorRole: Role,
  input: UpdateSessionInput
) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, proposedBy: true, title: true, metadata: true, programId: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (
    session.hostId !== actorId &&
    session.proposedBy !== actorId &&
    actorRole !== Role.ADMIN
  ) {
    throw new Error('NOT_AUTHORIZED');
  }

  // Audience axes — orthogonal flags, all independently editable post-create.
  //   openToAll : undefined → leave alone; boolean → set
  //   cohortId  : undefined → leave alone; null → clear; string → set (after
  //               verifying the cohort belongs to the session's program, same
  //               defense-in-depth check createSession runs).
  if (input.cohortId !== undefined && input.cohortId !== null) {
    const cohort = await db.cohort.findUnique({
      where: { id: input.cohortId },
      select: { id: true, programId: true },
    });
    if (!cohort) throw new Error('COHORT_NOT_FOUND');
    if (cohort.programId !== session.programId) throw new Error('COHORT_PROGRAM_MISMATCH');
  }

  // Objectives semantic: undefined → leave untouched; null or [] → clear; array → replace.
  let objectivesPatch: { objectives: Prisma.InputJsonValue | typeof Prisma.JsonNull } | Record<string, never> = {};
  if (input.objectives === undefined) {
    objectivesPatch = {};
  } else if (input.objectives === null) {
    objectivesPatch = { objectives: Prisma.JsonNull };
  } else {
    const normalised = normaliseObjectives(input.objectives);
    objectivesPatch = normalised === null
      ? { objectives: Prisma.JsonNull }
      : { objectives: normalised as unknown as Prisma.InputJsonValue };
  }

  // Merge prereq config into existing metadata so we don't clobber unrelated keys.
  let metadataPatch: { metadata: Prisma.InputJsonValue } | Record<string, never> = {};
  if (input.prereq !== undefined) {
    const existing =
      session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)
        ? (session.metadata as Record<string, unknown>)
        : {};
    metadataPatch = {
      metadata: { ...existing, prereq: input.prereq } as unknown as Prisma.InputJsonValue,
    };
  }

  const updated = await db.teachingSession.update({
    where: { id: sessionId },
    data: {
      title: input.title ?? undefined,
      description: input.description === undefined ? undefined : input.description,
      maxParticipants: input.maxParticipants ?? undefined,
      recordingEnabled: input.recordingEnabled ?? undefined,
      consentRequired: input.consentRequired ?? undefined,
      tags: input.tags ?? undefined,
      topicId: input.topicId === undefined ? undefined : input.topicId,
      openToAll: input.openToAll === undefined ? undefined : input.openToAll,
      cohortId: input.cohortId === undefined ? undefined : input.cohortId,
      ...objectivesPatch,
      ...metadataPatch,
    },
  });
  await audit({
    actorId,
    eventType: 'SESSION_UPDATED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Updated "${session.title}"`,
    details: input as unknown as Record<string, unknown>,
  });
  return updated;
}

// ----------------------------------------------------------------------------
// Invite management — add / list / remove invitees on INVITE_ONLY sessions
// ----------------------------------------------------------------------------

async function assertInviteEditor(sessionId: string, actorId: string, actorRole: Role) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true, proposedBy: true },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  // Audience axes are orthogonal under the new model — a host can layer
  // specific invitees on top of cohort-scoped or openToAll sessions.
  if (
    session.hostId !== actorId &&
    session.proposedBy !== actorId &&
    actorRole !== Role.ADMIN
  ) {
    throw new Error('NOT_AUTHORIZED');
  }
  return session;
}

export async function listSessionInvitees(sessionId: string, actorId: string, actorRole: Role) {
  await assertInviteEditor(sessionId, actorId, actorRole);
  return db.sessionInvite.findMany({
    where: { sessionId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, avatarUrl: true } },
    },
    orderBy: { invitedAt: 'asc' },
  });
}

export async function addSessionInvitees(
  sessionId: string,
  userIds: string[],
  actorId: string,
  actorRole: Role
) {
  await assertInviteEditor(sessionId, actorId, actorRole);

  // Keep only users that exist and are ACTIVE; silently drop the rest.
  const users = await db.user.findMany({
    where: { id: { in: userIds }, status: 'ACTIVE' },
    select: { id: true },
  });
  if (users.length === 0) return { added: 0 };

  const result = await db.sessionInvite.createMany({
    data: users.map((u) => ({
      sessionId,
      userId: u.id,
      invitedBy: actorId,
    })),
    skipDuplicates: true,
  });

  await audit({
    actorId,
    eventType: 'SESSION_INVITES_ADDED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Added ${result.count} invitee(s)`,
    details: { userIds: users.map((u) => u.id) },
  });

  return { added: result.count };
}

export async function removeSessionInvitee(
  sessionId: string,
  targetUserId: string,
  actorId: string,
  actorRole: Role
) {
  await assertInviteEditor(sessionId, actorId, actorRole);
  const existing = await db.sessionInvite.findUnique({
    where: { sessionId_userId: { sessionId, userId: targetUserId } },
  });
  if (!existing) throw new Error('INVITE_NOT_FOUND');

  await db.sessionInvite.delete({
    where: { sessionId_userId: { sessionId, userId: targetUserId } },
  });

  await audit({
    actorId,
    eventType: 'SESSION_INVITE_REMOVED',
    entityType: 'teaching_session',
    entityId: sessionId,
    summary: `Removed invite for ${targetUserId}`,
  });
}

export async function listSessionsPendingApproval(facultyUserId: string) {
  return db.teachingSession.findMany({
    where: {
      hostId: facultyUserId,
      approvalStatus: SessionApprovalStatus.PENDING_FACULTY,
      deletedAt: null,
    },
    include: {
      proposer: { select: { id: true, name: true, email: true } },
      cohort: { select: { id: true, name: true } },
      _count: { select: { invites: true } },
    },
    orderBy: { scheduledStart: 'asc' },
  });
}

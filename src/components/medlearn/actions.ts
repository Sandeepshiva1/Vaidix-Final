'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Prisma, Role, SessionApprovalStatus, SessionStatus, SessionType } from '@prisma/client';
import { forgeDeck, DeckForgeError } from '@/server/services/decks/deck-forge-service';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { emitToMany } from '@/server/services/notifications-service';
import { notifySessionApproved } from '@/server/services/session-notifications';

export interface CreateSessionFormInput {
  title: string;
  scheduledStart: string; // ISO
  durationMinutes: number;
  sessionType: SessionType;
  expectedLearners?: number;
  learnerLevel?: string;
  // ── Schedule-wizard fields (Classroom + Board Room) ──
  description?: string;
  /** Real cohort id (Classroom). Validated against the proposer's program. */
  cohortId?: string;
  /** Classroom role-group audience — fan out invites to every active member of
   *  the host's program whose effective role matches: RESIDENT ("All Residents"),
   *  FACULTY ("All Faculty"), or PROGRAM_DIRECTOR ("All HODs"). Mutually
   *  exclusive with `cohortId` (the wizard sends one or the other). */
  targetRole?: 'RESIDENT' | 'FACULTY' | 'PROGRAM_DIRECTOR';
  specialty?: string;
  subSpecialty?: string;
  /** Board Room: free-text "emails or names, comma-separated". @deprecated — the
   *  Board Room wizard now uses the directory picker (participantUserIds). Kept
   *  for backwards compatibility with any external caller. */
  participants?: string;
  /** Board Room: real users picked from the directory (flat list, no roles).
   *  Become SessionInvite rows + an in-app "you're invited" notification. */
  participantUserIds?: string[];
  /** Classroom: role assignments. Each name is a real user picked from search. */
  roles?: { role: string; userId?: string; name?: string }[];
  /** True for the Board Room variant (quick meeting, 30-day TTL). */
  isBoardRoom?: boolean;
  /** RFC-5545 RRULE body (no DTSTART), e.g. "FREQ=WEEKLY;BYDAY=MO,WE". Optional. */
  recurrenceRule?: string;
  /** Cutoff date for recurrence expansion (ISO). Used by the classroom feed. */
  recurrenceUntil?: string;
}

export type CreateSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

// Role-group audiences the Classroom picker can target program-wide.
const ROLE_AUDIENCE_ROLES: Role[] = [Role.RESIDENT, Role.FACULTY, Role.PROGRAM_DIRECTOR];

/**
 * Every active member of a program whose effective role matches `role`. Used by
 * the Classroom "All Residents / All Faculty / All HODs" picker options to fan
 * out invites. Effective role honours the per-program override
 * (ProgramMembership.role ?? User.role). The host is excluded (they're the
 * presenter, not an invitee).
 */
async function listProgramRoleAudienceIds(
  programId: string,
  role: Role,
  excludeUserId: string,
): Promise<string[]> {
  const members = await db.programMembership.findMany({
    where: { programId, user: { status: 'ACTIVE', deletedAt: null } },
    select: { role: true, user: { select: { id: true, role: true } } },
  });

  const ids = new Set<string>();
  for (const m of members) {
    const effectiveRole = m.role ?? m.user.role;
    if (effectiveRole === role) ids.add(m.user.id);
  }
  ids.delete(excludeUserId);
  return [...ids];
}

/**
 * Lightweight session creator for the MedLearn workflow surface.
 *
 * Bypasses the full proposal/approval workflow used by `createSession` in
 * src/server/services/session-service.ts — that path validates against
 * cohorts, conflicts, audit trail, etc. For the simple "doctor schedules
 * their own teaching session" flow we only need the minimum viable record.
 *
 * Auto-approves because the proposer is also the host (faculty path).
 */
export async function createTeachingSessionAction(input: CreateSessionFormInput): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'You must be signed in.' };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, activeProgramId: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return { ok: false, error: 'Your account is not active.' };
  if (!user.activeProgramId) return { ok: false, error: 'No active program selected.' };

  if (
    user.role !== Role.FACULTY &&
    user.role !== Role.PROGRAM_DIRECTOR &&
    user.role !== Role.ADMIN &&
    user.role !== Role.RESIDENT
  ) {
    return { ok: false, error: 'Your role cannot create sessions.' };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Title is required.' };

  const start = new Date(input.scheduledStart);
  if (Number.isNaN(start.getTime())) return { ok: false, error: 'Invalid start time.' };
  // Block back-dated sessions. 5-minute grace absorbs clock skew + the seconds
  // spent filling the form; matches the client guard in the create wizard and
  // the /calendar/new scheduler.
  if (start.getTime() < Date.now() - 5 * 60 * 1000) {
    return { ok: false, error: 'Start time has already passed — pick a future time.' };
  }
  // Sessions cap at 240 minutes (4h); manual entry in the wizard enforces the
  // same ceiling client-side.
  const duration = Math.max(15, Math.min(240, input.durationMinutes));
  const end = new Date(start.getTime() + duration * 60_000);

  // ── Cohort (optional, Classroom) — must belong to the proposer's program ──
  let cohortId: string | null = null;
  if (input.cohortId) {
    const cohort = await db.cohort.findUnique({
      where: { id: input.cohortId },
      select: { id: true, programId: true, deletedAt: true },
    });
    if (!cohort || cohort.deletedAt) return { ok: false, error: 'Selected cohort no longer exists.' };
    if (cohort.programId !== user.activeProgramId) return { ok: false, error: 'Cohort belongs to a different program.' };
    cohortId = cohort.id;
  }

  // ── Board Room participants — resolve "email, email" tokens to real users ──
  const participantTokens = (input.participants ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const emailTokens = participantTokens.filter((t) => t.includes('@'));
  const inviteeUserIds: string[] = [];
  const matchedEmails = new Set<string>();
  if (emailTokens.length > 0) {
    // Match exact + lowercased so "Dr@X.org" still finds a lowercase-stored row.
    const candidates = Array.from(new Set(emailTokens.flatMap((e) => [e, e.toLowerCase()])));
    const matched = await db.user.findMany({
      where: { email: { in: candidates }, status: 'ACTIVE' },
      select: { id: true, email: true },
    });
    for (const m of matched) {
      matchedEmails.add(m.email.toLowerCase());
      if (m.id !== user.id) inviteeUserIds.push(m.id);
    }
  }
  const unresolvedParticipants = participantTokens.filter(
    (t) => !t.includes('@') || !matchedEmails.has(t.toLowerCase()),
  );

  // ── Classroom role assignments — each name is a real user picked from search ──
  const roleUserIds = (input.roles ?? [])
    .map((r) => r.userId)
    .filter((id): id is string => Boolean(id));
  let roleInviteeIds: string[] = [];
  if (roleUserIds.length > 0) {
    // Picker only surfaces real program users, but validate to guard the FK
    // against a stale/forged payload before createMany.
    const existing = await db.user.findMany({
      where: { id: { in: roleUserIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    roleInviteeIds = existing.map((e) => e.id).filter((id) => id !== user.id);
  }

  // ── Board Room participants — real users picked from the directory (no roles) ──
  // The picker only surfaces real program users, but validate against the DB to
  // guard the SessionInvite FK against a stale/forged payload before createMany.
  const participantUserIds = Array.from(new Set(input.participantUserIds ?? [])).filter(Boolean);
  let participantInviteeIds: string[] = [];
  if (participantUserIds.length > 0) {
    const existing = await db.user.findMany({
      where: { id: { in: participantUserIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    participantInviteeIds = existing.map((e) => e.id).filter((id) => id !== user.id);
  }

  // ── Role-group audience (Classroom) — fan out to all program members of a
  // role (All Residents / All Faculty / All HODs). Concrete SessionInvite rows
  // (built below from allInviteeIds) give every targeted user feed/calendar
  // visibility AND an in-app "you're invited" alert.
  const targetRole = ROLE_AUDIENCE_ROLES.includes(input.targetRole as Role)
    ? (input.targetRole as Role)
    : null;
  let roleAudienceIds: string[] = [];
  if (targetRole && !input.isBoardRoom) {
    roleAudienceIds = await listProgramRoleAudienceIds(user.activeProgramId, targetRole, user.id);
  }

  const allInviteeIds = Array.from(
    new Set([...inviteeUserIds, ...roleInviteeIds, ...participantInviteeIds, ...roleAudienceIds]),
  );

  // ── Fields with no dedicated column are preserved in metadata ──
  const metadata: Record<string, unknown> = {};
  if (input.isBoardRoom) {
    metadata.kind = 'BOARD_ROOM';
    // Board rooms auto-delete 30 days after creation (sweep job is a follow-up).
    metadata.autoDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (input.specialty) metadata.specialty = input.specialty;
  if (input.subSpecialty) metadata.subSpecialty = input.subSpecialty;
  // Remember the role-group audience so the edit form can re-select it (the
  // session stores no cohortId in that case — the audience is the invite fan-out).
  if (targetRole) metadata.audienceRole = targetRole;
  const namedRoles = (input.roles ?? []).filter((r) => r.userId);
  if (namedRoles.length > 0) metadata.roles = namedRoles;
  if (participantTokens.length > 0) {
    metadata.participants = participantTokens;
    if (unresolvedParticipants.length > 0) metadata.unresolvedParticipants = unresolvedParticipants;
  }

  const description = input.description?.trim() ? input.description.trim() : null;
  const tags = Array.from(
    new Set([input.learnerLevel, input.specialty, input.subSpecialty].filter(Boolean) as string[]),
  );

  // Recurrence (Classroom wizard). The client builds a validated RRULE body via
  // the rrule lib; we sanity-check the shape before persisting so a malformed
  // payload can never reach the calendar expander. `recurrenceUntil` mirrors the
  // UNTIL inside the rule and is read by the classroom feed's occurrence cutoff.
  const rawRule = input.recurrenceRule?.trim();
  const recurrenceRule =
    rawRule && /^FREQ=/.test(rawRule) && rawRule.length <= 500 ? rawRule : null;
  let recurrenceUntil: Date | null = null;
  if (recurrenceRule && input.recurrenceUntil) {
    const until = new Date(input.recurrenceUntil);
    if (!Number.isNaN(until.getTime())) recurrenceUntil = until;
  }

  const created = await db.teachingSession.create({
    data: {
      title,
      description,
      sessionType: input.sessionType,
      hostId: user.id,
      proposedBy: user.id,
      programId: user.activeProgramId,
      status: SessionStatus.SCHEDULED,
      approvalStatus: SessionApprovalStatus.APPROVED,
      approvedBy: user.id,
      approvedAt: new Date(),
      scheduledStart: start,
      scheduledEnd: end,
      recurrenceRule,
      recurrenceUntil,
      cohortId,
      maxParticipants: input.expectedLearners ? Math.max(1, input.expectedLearners) : 100,
      recordingEnabled: true,
      consentRequired: true,
      tags,
      metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
    select: { id: true },
  });

  // Board Room participants + Classroom role users → real SessionInvite rows
  // (idempotent on [session, user]).
  if (allInviteeIds.length > 0) {
    await db.sessionInvite.createMany({
      data: allInviteeIds.map((uid) => ({
        sessionId: created.id,
        userId: uid,
        invitedBy: user.id,
      })),
      skipDuplicates: true,
    });

    if (input.isBoardRoom) {
      // In-app alert for board-room participants. Deep-links to /classroom/{id}.
      // Fire-and-forget; never blocks creation.
      const startLabel = start.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      await emitToMany(
        allInviteeIds.map((uid) => ({
          userId: uid,
          kind: 'session.invited.boardroom',
          title: `Board room invite: ${title}`,
          body: `${start < new Date() ? 'Started' : 'Starts'} ${startLabel}`,
          payload: { sessionId: created.id },
        })),
      );
    }
  }

  if (!input.isBoardRoom) {
    // Classroom sessions: notify via the proper session-notifications path so
    // cohort members are included (resolveAttendees unions cohort + invitees).
    // This also sends the .ics email to all attendees. Fire-and-forget.
    notifySessionApproved(created.id).catch((err) =>
      console.error('[actions] notifySessionApproved failed', err),
    );
  }

  await audit({
    actorId: user.id,
    actorRole: user.role,
    eventType: AUDIT_EVENTS.SESSION_CREATED,
    entityType: 'session',
    entityId: created.id,
    summary: `${input.isBoardRoom ? 'Created board room' : 'Scheduled session'} "${title}"`,
    details: {
      sessionType: input.sessionType,
      isBoardRoom: Boolean(input.isBoardRoom),
      scheduledStart: start.toISOString(),
      specialty: input.specialty ?? null,
      recurring: Boolean(recurrenceRule),
    },
  });

  revalidatePath('/dashboard');
  return { ok: true, sessionId: created.id };
}

/**
 * Edit an existing classroom session — the "Create a Classroom" wizard in edit
 * mode, pre-filled with the session's details. Editable only until the session
 * starts (status SCHEDULED) and only by the host, the proposer, or an ADMIN /
 * PROGRAM_DIRECTOR. Host, program and approval state are preserved; just the
 * schedulable details change (title, schedule, format, audience, recurrence,
 * role assignments).
 */
export async function updateTeachingSessionAction(
  sessionId: string,
  input: CreateSessionFormInput,
): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'You must be signed in.' };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return { ok: false, error: 'Your account is not active.' };

  const existing = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true, proposedBy: true, programId: true, status: true, deletedAt: true, metadata: true },
  });
  if (!existing || existing.deletedAt) return { ok: false, error: 'Session not found.' };

  const canEdit =
    existing.hostId === user.id ||
    existing.proposedBy === user.id ||
    user.role === Role.ADMIN ||
    user.role === Role.PROGRAM_DIRECTOR;
  if (!canEdit) return { ok: false, error: 'You can’t edit this session.' };

  // Edit is allowed up until the session starts — a LIVE or ENDED session is
  // locked. (Matches the "edit until it starts" rule on the dashboard card.)
  if (existing.status !== SessionStatus.SCHEDULED) {
    return { ok: false, error: 'Only upcoming sessions can be edited.' };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Title is required.' };

  const start = new Date(input.scheduledStart);
  if (Number.isNaN(start.getTime())) return { ok: false, error: 'Invalid start time.' };
  if (start.getTime() < Date.now() - 5 * 60 * 1000) {
    return { ok: false, error: 'Start time has already passed — pick a future time.' };
  }
  const duration = Math.max(15, Math.min(360, input.durationMinutes));
  const end = new Date(start.getTime() + duration * 60_000);

  // Cohort must belong to the SESSION's program (not the editor's active one).
  let cohortId: string | null = null;
  if (input.cohortId) {
    const cohort = await db.cohort.findUnique({
      where: { id: input.cohortId },
      select: { id: true, programId: true, deletedAt: true },
    });
    if (!cohort || cohort.deletedAt) return { ok: false, error: 'Selected cohort no longer exists.' };
    if (cohort.programId !== existing.programId) return { ok: false, error: 'Cohort belongs to a different program.' };
    cohortId = cohort.id;
  }

  // Role assignments → invitees (validated against the FK; host excluded).
  const roleUserIds = (input.roles ?? [])
    .map((r) => r.userId)
    .filter((id): id is string => Boolean(id));
  let roleInviteeIds: string[] = [];
  if (roleUserIds.length > 0) {
    const ex = await db.user.findMany({
      where: { id: { in: roleUserIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    roleInviteeIds = ex.map((e) => e.id).filter((id) => id !== existing.hostId);
  }

  // Merge metadata so we don't clobber keys the wizard doesn't manage (kind,
  // autoDeleteAt, participants, prereq, …).
  const meta: Record<string, unknown> =
    existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? { ...(existing.metadata as Record<string, unknown>) }
      : {};
  if (input.specialty) meta.specialty = input.specialty; else delete meta.specialty;
  if (input.subSpecialty) meta.subSpecialty = input.subSpecialty; else delete meta.subSpecialty;
  const editTargetRole = ROLE_AUDIENCE_ROLES.includes(input.targetRole as Role)
    ? (input.targetRole as Role)
    : null;
  if (editTargetRole) meta.audienceRole = editTargetRole; else delete meta.audienceRole;
  const namedRoles = (input.roles ?? []).filter((r) => r.userId);
  if (namedRoles.length > 0) meta.roles = namedRoles; else delete meta.roles;

  const rawRule = input.recurrenceRule?.trim();
  const recurrenceRule =
    rawRule && /^FREQ=/.test(rawRule) && rawRule.length <= 500 ? rawRule : null;
  let recurrenceUntil: Date | null = null;
  if (recurrenceRule && input.recurrenceUntil) {
    const until = new Date(input.recurrenceUntil);
    if (!Number.isNaN(until.getTime())) recurrenceUntil = until;
  }

  const tags = Array.from(
    new Set([input.learnerLevel, input.specialty, input.subSpecialty].filter(Boolean) as string[]),
  );

  await db.teachingSession.update({
    where: { id: sessionId },
    data: {
      title,
      description: input.description?.trim() ? input.description.trim() : null,
      sessionType: input.sessionType,
      scheduledStart: start,
      scheduledEnd: end,
      recurrenceRule,
      recurrenceUntil,
      cohortId,
      tags,
      metadata: Object.keys(meta).length > 0 ? (meta as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });

  // Add any newly-assigned role users as invitees (idempotent). When "All
  // learners" is (re)selected, also fan out to the whole program audience. We
  // don't delete existing invites here so cohort/manual invitees are preserved.
  const editRoleAudienceIds = editTargetRole
    ? await listProgramRoleAudienceIds(existing.programId, editTargetRole, existing.hostId)
    : [];
  const editInviteeIds = Array.from(new Set([...roleInviteeIds, ...editRoleAudienceIds]));
  if (editInviteeIds.length > 0) {
    await db.sessionInvite.createMany({
      data: editInviteeIds.map((uid) => ({ sessionId, userId: uid, invitedBy: user.id })),
      skipDuplicates: true,
    });
  }

  await audit({
    actorId: user.id,
    actorRole: user.role,
    eventType: AUDIT_EVENTS.SESSION_CREATED,
    entityType: 'session',
    entityId: sessionId,
    summary: `Edited session "${title}"`,
    details: { scheduledStart: start.toISOString(), recurring: Boolean(recurrenceRule) },
  }).catch(() => { /* audit is best-effort */ });

  revalidatePath('/dashboard');
  revalidatePath(`/classroom/${sessionId}`);
  revalidatePath(`/session/${sessionId}/pre`);
  return { ok: true, sessionId };
}

/**
 * Mark a session as LIVE — sets actualStart and flips status. Used by the
 * "I'm Ready — Start Session →" CTA on the Pre-Conference screen.
 */
export async function startSessionAction(sessionId: string): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };

  const existing = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, status: true },
  });
  if (!existing) return { ok: false, error: 'Session not found.' };
  if (existing.hostId !== session.user.id) return { ok: false, error: 'Only the host can start this session.' };
  if (existing.status === SessionStatus.ENDED) return { ok: false, error: 'Session has already ended.' };

  await db.teachingSession.update({
    where: { id: sessionId },
    data: {
      status: SessionStatus.LIVE,
      actualStart: existing.status === SessionStatus.LIVE ? undefined : new Date(),
    },
  });

  revalidatePath(`/session/${sessionId}/pre`);
  revalidatePath(`/session/${sessionId}/live`);
  return { ok: true, sessionId };
}

export type AttachDeckResult =
  | { ok: true; jobId: string; slideCount: number; deckTitle: string }
  | { ok: false; error: string; code?: string };

/**
 * Wire a freshly uploaded Document to the session and synchronously kick off
 * Deck Forge so Slide rows exist for the Studio + LiveScreen to render.
 *
 * Runs sync (not background) because:
 *   • Gemini text returns in 5–30s, comparable to a normal page load
 *   • the user is staring at the upload UI waiting for confirmation, so
 *     they get a clean "Deck ready · 18 slides" outcome instead of a
 *     "we'll notify you" handwave that needs separate polling infra
 *   • Phase B in the existing code already pencils in moving this to BullMQ
 *
 * If forgeDeck throws (no Gemini key, bad source, AI parse error), we still
 * keep the DocumentSessionLink so the file is at least downloadable; the
 * Pre screen surfaces the error and offers a re-run path.
 */
export async function attachDocumentAndForgeAction(
  sessionId: string,
  documentId: string,
): Promise<AttachDeckResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };

  const [sessionRow, doc] = await Promise.all([
    db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, hostId: true, title: true },
    }),
    db.document.findUnique({
      where: { id: documentId },
      select: { id: true, uploadedById: true, title: true },
    }),
  ]);
  if (!sessionRow) return { ok: false, error: 'Session not found.' };
  if (!doc) return { ok: false, error: 'Document not found.' };
  if (sessionRow.hostId !== session.user.id && doc.uploadedById !== session.user.id) {
    return { ok: false, error: 'You do not have permission to attach this document.' };
  }

  // Link is idempotent on (documentId, sessionId) per the @@unique on the model.
  await db.documentSessionLink.upsert({
    where: { documentId_sessionId: { documentId, sessionId } },
    update: {},
    create: {
      sessionId,
      documentId,
      linkedById: session.user.id,
      isPreSession: true,
    },
  });

  try {
    const outcome = await forgeDeck({
      documentId,
      requestedById: session.user.id,
      inputTitle: doc.title || sessionRow.title,
    });
    revalidatePath(`/session/${sessionId}/pre`);
    revalidatePath(`/session/${sessionId}/live`);
    return { ok: true, ...outcome };
  } catch (err) {
    const code = err instanceof DeckForgeError ? err.code : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code, error: msg };
  }
}

/**
 * Mark the "Responses & Analytics" pre-conference step as reviewed. Unlike the
 * other steps (which derive from real data — an approved deck, invites, promo
 * docs, pre-questions), analytics is an acknowledgement: the host/faculty has
 * looked at the readiness + quiz dashboard. We persist that as a metadata flag
 * (`analyticsReviewed`) which loadSessionView reads back to light up the step.
 *
 * Backs the "Mark analytics reviewed" CTA on /session/[id]/analytics.
 */
export async function markAnalyticsReviewedAction(sessionId: string): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };

  const existing = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true, deletedAt: true, metadata: true },
  });
  if (!existing || existing.deletedAt) return { ok: false, error: 'Session not found.' };

  // Mirror the access guard on the analytics page: host or faculty-like.
  const isHost = existing.hostId === session.user.id;
  const isFacultyLike =
    session.user.role === Role.FACULTY ||
    session.user.role === Role.PROGRAM_DIRECTOR ||
    session.user.role === Role.ADMIN;
  if (!isHost && !isFacultyLike) return { ok: false, error: 'You can’t review analytics for this session.' };

  // Merge so we don't clobber other metadata keys (roles, specialty, learnerPrep, …).
  const meta: Record<string, unknown> =
    existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? { ...(existing.metadata as Record<string, unknown>) }
      : {};
  meta.analyticsReviewed = true;

  await db.teachingSession.update({
    where: { id: sessionId },
    data: { metadata: meta as Prisma.InputJsonValue },
  });

  revalidatePath(`/session/${sessionId}/pre`);
  revalidatePath(`/session/${sessionId}/analytics`);
  revalidatePath(`/session/${sessionId}/ready`);
  return { ok: true, sessionId };
}

/**
 * End a session — flips status to ENDED, records actualEnd. Used by the
 * "End Session" button on the Live screen.
 */
export async function endSessionAction(sessionId: string): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };

  const existing = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, status: true },
  });
  if (!existing) return { ok: false, error: 'Session not found.' };
  if (existing.hostId !== session.user.id) return { ok: false, error: 'Only the host can end this session.' };

  await db.teachingSession.update({
    where: { id: sessionId },
    data: {
      status: SessionStatus.ENDED,
      actualEnd: new Date(),
    },
  });

  revalidatePath(`/session/${sessionId}/live`);
  revalidatePath(`/session/${sessionId}/post`);
  revalidatePath('/dashboard');
  return { ok: true, sessionId };
}

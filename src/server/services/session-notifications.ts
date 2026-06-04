// ════════════════════════════════════════════════════════════════════════════
// Session Notifications — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Sends proposed / approved / rejected / rescheduled / cancelled / reminder
// emails with a matching .ics attachment. Resolves the recipient set
// (host, proposer, attendees) from the session's visibility rules.

import { db } from '@/lib/db';
import { sendEmail, type EmailAttachment } from '@/lib/email';
import {
  renderSessionProposedEmail,
  renderSessionApprovedEmail,
  renderSessionRejectedEmail,
  renderSessionRescheduledEmail,
  renderSessionCancelledEmail,
  renderSessionReminderEmail,
} from '@/lib/email-templates';
import { buildSessionIcs, sessionJoinUrl } from './ics-service';
import { env } from '@/lib/env';
import { NotificationChannel, UserStatus } from '@prisma/client';
import { emit, emitToMany } from './notifications-service';

const CALENDAR_URL = `${env.NEXTAUTH_URL.replace(/\/$/, '')}/calendar`;
const APPROVAL_INBOX_URL = `${env.NEXTAUTH_URL.replace(/\/$/, '')}/inbox/approvals`;

type SessionWithRels = Awaited<ReturnType<typeof loadSession>>;

async function loadSession(sessionId: string) {
  return db.teachingSession.findUnique({
    where: { id: sessionId },
    include: {
      host: { select: { id: true, name: true, email: true, status: true } },
      proposer: { select: { id: true, name: true, email: true, status: true } },
    },
  });
}

function icsAttachmentForSession(
  session: NonNullable<SessionWithRels>,
  opts: { cancelled?: boolean } = {}
): EmailAttachment {
  const icsText = buildSessionIcs({
    id: session.id,
    title: session.title,
    description: session.description,
    start: session.scheduledStart,
    end: session.scheduledEnd,
    host: { name: session.host.name, email: session.host.email },
    joinUrl: sessionJoinUrl(session.id),
    recurrenceRule: session.recurrenceRule,
    recurrenceUntil: session.recurrenceUntil,
    status: opts.cancelled ? 'CANCELLED' : 'CONFIRMED',
  });
  return {
    filename: `vaidix-${session.id}.ics`,
    content: icsText,
    contentType: 'text/calendar; method=PUBLISH; charset=utf-8',
  };
}

function sharedVarsFor(session: NonNullable<SessionWithRels>) {
  return {
    sessionTitle: session.title,
    sessionType: session.sessionType,
    start: session.scheduledStart,
    end: session.scheduledEnd,
    hostName: session.host.name,
    proposerName: session.proposer.name,
    sessionUrl: sessionJoinUrl(session.id),
    calendarUrl: CALENDAR_URL,
  };
}

// ----------------------------------------------------------------------------
// Recipient resolution — union of explicit audiences (cohort members + named
// invitees), deduped. `openToAll` deliberately does NOT add recipients: a
// link-only session has no broadcast list. If a host wants to email a wide
// group they must also pick a cohort (or invite individuals). This stops the
// silent "blast every resident + faculty in the institution" path the old
// OPEN_TO_ALL default had.
// ----------------------------------------------------------------------------
async function resolveAttendees(
  session: NonNullable<SessionWithRels>
): Promise<{ id: string; name: string; email: string }[]> {
  const byId = new Map<string, { id: string; name: string; email: string }>();

  if (session.cohortId) {
    const members = await db.cohortMember.findMany({
      where: { cohortId: session.cohortId, user: { status: UserStatus.ACTIVE } },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    for (const m of members) {
      byId.set(m.user.id, { id: m.user.id, name: m.user.name, email: m.user.email });
    }
  }

  const invites = await db.sessionInvite.findMany({
    where: { sessionId: session.id, status: { in: ['INVITED', 'ACCEPTED'] } },
    include: { user: { select: { id: true, name: true, email: true, status: true } } },
  });
  for (const i of invites) {
    if (i.user.status !== UserStatus.ACTIVE) continue;
    byId.set(i.user.id, { id: i.user.id, name: i.user.name, email: i.user.email });
  }

  return Array.from(byId.values());
}

// ----------------------------------------------------------------------------
// Low-level sender — swallows per-recipient errors to avoid blocking the
// lifecycle transaction; logs + returns summary for the caller to audit.
// ----------------------------------------------------------------------------
async function safeSend(to: string, subject: string, html: string, attachments?: EmailAttachment[]) {
  try {
    await sendEmail({ to, subject, html, attachments });
    return { to, ok: true };
  } catch (err) {
    console.error('[session-notifications] send failed', { to, subject, err: (err as Error).message });
    return { to, ok: false, error: (err as Error).message };
  }
}

// ----------------------------------------------------------------------------
// Public API — one function per lifecycle event.
// ----------------------------------------------------------------------------

export async function notifySessionProposed(sessionId: string) {
  const session = await loadSession(sessionId);
  if (!session) return;
  if (session.host.status !== UserStatus.ACTIVE) return;

  const inviteCount = await db.sessionInvite.count({ where: { sessionId } });
  const { subject, html } = renderSessionProposedEmail({
    ...sharedVarsFor(session),
    recipientName: session.host.name,
    approvalUrl: APPROVAL_INBOX_URL,
    inviteCount,
  });

  // In-app notification — drives the bell/badge in the header. Email may be
  // delayed or filtered; this row is the source of truth for the inbox UI.
  // Time is carried in `payload.scheduledStart` (ISO) and rendered client-side
  // in the user's locale; never embed `.toLocaleString()` here, since the
  // server runs UTC and would display an off-by-timezone clock (QA #14).
  await db.notification.create({
    data: {
      userId: session.host.id,
      channel: NotificationChannel.IN_APP,
      kind: 'session.proposed',
      title: `${session.proposer.name} proposed a session for your approval`,
      body: session.title,
      payload: {
        sessionId: session.id,
        scheduledStart: session.scheduledStart.toISOString(),
        scheduledEnd: session.scheduledEnd.toISOString(),
        proposerId: session.proposer.id,
        approvalUrl: APPROVAL_INBOX_URL,
      },
    },
  });

  await safeSend(session.host.email, subject, html);
}

export async function notifySessionApproved(sessionId: string) {
  const session = await loadSession(sessionId);
  if (!session) return;
  const attachment = icsAttachmentForSession(session);
  const shared = sharedVarsFor(session);

  const notifPayload = {
    sessionId: session.id,
    scheduledStart: session.scheduledStart.toISOString(),
    scheduledEnd: session.scheduledEnd.toISOString(),
  };

  if (session.proposer.id !== session.host.id && session.proposer.status === UserStatus.ACTIVE) {
    // Proposer != host → a faculty approved a resident's proposal. Confirm
    // back to the proposer.
    await emit({
      userId: session.proposer.id,
      kind: 'session.approved',
      title: `${session.host.name} approved your session`,
      body: session.title,
      payload: notifPayload,
    });

    const { subject, html } = renderSessionApprovedEmail({
      ...shared,
      recipientName: session.proposer.name,
      recipientRole: 'PROPOSER',
    });
    await safeSend(session.proposer.email, subject, html, [attachment]);
  } else if (session.host.status === UserStatus.ACTIVE) {
    // Self-host (auto-approved) — proposer == host. Confirm to the host
    // directly so they get an inbox row for the session they just scheduled,
    // matching the audit trail attendees see.
    await emit({
      userId: session.host.id,
      kind: 'session.approved',
      title: `Session scheduled: ${session.title}`,
      body: null,
      payload: notifPayload,
    });
  }

  // Attendees — emit IN_APP rows (the bell/inbox is the source of truth) AND
  // send the email with the .ics attachment. Without the emit the only signal
  // a cohort member gets is the email, which is filterable / muteable.
  const attendees = await resolveAttendees(session);
  if (attendees.length > 0) {
    await emitToMany(
      attendees.map((u) => ({
        userId: u.id,
        kind: 'session.approved',
        title: `${session.host.name} scheduled: ${session.title}`,
        body: null,
        payload: notifPayload,
      }))
    );
    await Promise.all(
      attendees.map((u) => {
        const { subject, html } = renderSessionApprovedEmail({
          ...shared,
          recipientName: u.name,
          recipientRole: 'ATTENDEE',
        });
        return safeSend(u.email, subject, html, [attachment]);
      })
    );
  }
}

export async function notifySessionRejected(sessionId: string, reason: string) {
  const session = await loadSession(sessionId);
  if (!session) return;
  if (session.proposer.id === session.host.id) return; // self-rejection is a UI-only case
  if (session.proposer.status !== UserStatus.ACTIVE) return;

  const { subject, html } = renderSessionRejectedEmail({
    ...sharedVarsFor(session),
    recipientName: session.proposer.name,
    reason,
  });
  await safeSend(session.proposer.email, subject, html);

  await emit({
    userId: session.proposer.id,
    kind: 'session.rejected',
    title: `${session.host.name} declined your session`,
    body: reason ? `${session.title} — ${reason}` : session.title,
    payload: {
      sessionId: session.id,
      scheduledStart: session.scheduledStart.toISOString(),
      reason,
    },
  });
}

export async function notifySessionRescheduled(
  sessionId: string,
  previous: { start: Date; end: Date },
  requiresApproval: boolean
) {
  const session = await loadSession(sessionId);
  if (!session) return;
  const attachment = icsAttachmentForSession(session);
  const shared = sharedVarsFor(session);

  const notifPayload = {
    sessionId: session.id,
    previousStart: previous.start.toISOString(),
    previousEnd: previous.end.toISOString(),
    scheduledStart: session.scheduledStart.toISOString(),
    scheduledEnd: session.scheduledEnd.toISOString(),
    requiresApproval,
  };

  // Host gets one
  if (session.host.status === UserStatus.ACTIVE) {
    const { subject, html } = renderSessionRescheduledEmail({
      ...shared,
      recipientName: session.host.name,
      recipientRole: 'HOST',
      previousStart: previous.start,
      previousEnd: previous.end,
      requiresApproval,
      approvalUrl: APPROVAL_INBOX_URL,
    });
    await safeSend(session.host.email, subject, html, [attachment]);
    await emit({
      userId: session.host.id,
      kind: 'session.rescheduled',
      title: `Session rescheduled: ${session.title}`,
      body: 'The schedule has changed — new time below.',
      payload: notifPayload,
    });
  }

  // Attendees only see the updated .ics if the session is already APPROVED.
  // If requiresApproval, wait until re-approval to notify attendees.
  if (!requiresApproval) {
    const attendees = await resolveAttendees(session);
    await Promise.all(
      attendees.map((u) => {
        const { subject, html } = renderSessionRescheduledEmail({
          ...shared,
          recipientName: u.name,
          recipientRole: 'ATTENDEE',
          previousStart: previous.start,
          previousEnd: previous.end,
          requiresApproval: false,
        });
        return safeSend(u.email, subject, html, [attachment]);
      })
    );
    await emitToMany(
      attendees.map((u) => ({
        userId: u.id,
        kind: 'session.rescheduled',
        title: `Session rescheduled: ${session.title}`,
        body: 'The schedule has changed — new time below.',
        payload: notifPayload,
      }))
    );
  }
}

export async function notifySessionCancelled(sessionId: string, reason?: string | null) {
  const session = await loadSession(sessionId);
  if (!session) return;
  const attachment = icsAttachmentForSession(session, { cancelled: true });
  const shared = sharedVarsFor(session);

  const toNotify: { id: string; name: string; email: string }[] = [];
  if (session.host.status === UserStatus.ACTIVE) {
    toNotify.push({ id: session.host.id, name: session.host.name, email: session.host.email });
  }
  if (
    session.proposer.id !== session.host.id &&
    session.proposer.status === UserStatus.ACTIVE
  ) {
    toNotify.push({
      id: session.proposer.id,
      name: session.proposer.name,
      email: session.proposer.email,
    });
  }
  const attendees = await resolveAttendees(session);
  for (const a of attendees) {
    if (!toNotify.some((u) => u.id === a.id)) toNotify.push(a);
  }

  await Promise.all(
    toNotify.map((u) => {
      const { subject, html } = renderSessionCancelledEmail({
        ...shared,
        recipientName: u.name,
        reason: reason ?? null,
      });
      return safeSend(u.email, subject, html, [attachment]);
    })
  );

  await emitToMany(
    toNotify.map((u) => ({
      userId: u.id,
      kind: 'session.cancelled',
      title: `Session cancelled: ${session.title}`,
      body: reason ?? 'Originally scheduled for the time below.',
      payload: {
        sessionId: session.id,
        scheduledStart: session.scheduledStart.toISOString(),
        reason: reason ?? null,
      },
    }))
  );
}

// ----------------------------------------------------------------------------
// Lifecycle: SCHEDULED → LIVE. In-app only (no email — the session is
// literally happening right now, an email arriving 5–30 min late is noise).
// Recipients: host + attendees (cohort members + named invitees). We don't
// try to suppress notifying people who happen to already be in the room —
// the bell de-dupes visually, and the structural cost of querying
// LiveKit-side presence here isn't worth the marginal UX win.
// ----------------------------------------------------------------------------
export async function notifySessionStarted(sessionId: string) {
  const session = await loadSession(sessionId);
  if (!session) return;

  const notifPayload = {
    sessionId: session.id,
    scheduledStart: session.scheduledStart.toISOString(),
    scheduledEnd: session.scheduledEnd.toISOString(),
  };

  const recipients: { id: string; name: string; email: string }[] = [];
  if (session.host.status === UserStatus.ACTIVE) {
    recipients.push({ id: session.host.id, name: session.host.name, email: session.host.email });
  }
  const attendees = await resolveAttendees(session);
  for (const a of attendees) {
    if (!recipients.some((u) => u.id === a.id)) recipients.push(a);
  }

  if (recipients.length === 0) return;

  await emitToMany(
    recipients.map((u) => ({
      userId: u.id,
      kind: 'session.started',
      title: `Live now: ${session.title}`,
      body: `Hosted by ${session.host.name}`,
      payload: notifPayload,
    }))
  );
}

// ----------------------------------------------------------------------------
// Lifecycle: → ENDED (host clicked End, or auto-end sweep timed out). In-app
// only — same rationale as `notifySessionStarted`. The notification kind
// resolves to the recording page so attendees can jump straight to it once
// the transcribe-worker has populated `recording` rows.
// ----------------------------------------------------------------------------
export async function notifySessionEnded(sessionId: string) {
  const session = await loadSession(sessionId);
  if (!session) return;

  const notifPayload = {
    sessionId: session.id,
    scheduledStart: session.scheduledStart.toISOString(),
    scheduledEnd: session.scheduledEnd.toISOString(),
  };

  const recipients: { id: string; name: string; email: string }[] = [];
  if (session.host.status === UserStatus.ACTIVE) {
    recipients.push({ id: session.host.id, name: session.host.name, email: session.host.email });
  }
  const attendees = await resolveAttendees(session);
  for (const a of attendees) {
    if (!recipients.some((u) => u.id === a.id)) recipients.push(a);
  }

  if (recipients.length === 0) return;

  await emitToMany(
    recipients.map((u) => ({
      userId: u.id,
      kind: 'session.ended',
      title: `Session ended: ${session.title}`,
      body: 'Recording will be available shortly.',
      payload: notifPayload,
    }))
  );
}

export async function notifySessionReminder(sessionId: string, leadTime: '24H' | '15MIN') {
  const session = await loadSession(sessionId);
  if (!session) return;
  if (session.approvalStatus !== 'APPROVED') return; // don't remind pending/cancelled sessions
  if (session.status === 'CANCELLED' || session.status === 'ENDED') return;

  const shared = sharedVarsFor(session);
  const recipients: { id: string; name: string; email: string }[] = [];
  if (session.host.status === UserStatus.ACTIVE) {
    recipients.push({ id: session.host.id, name: session.host.name, email: session.host.email });
  }
  const attendees = await resolveAttendees(session);
  recipients.push(...attendees);

  await Promise.all(
    recipients.map((u) => {
      const { subject, html } = renderSessionReminderEmail({
        ...shared,
        recipientName: u.name,
        leadTime,
      });
      return safeSend(u.email, subject, html);
    })
  );

  const leadLabel = leadTime === '24H' ? '24 hours' : '15 minutes';
  await emitToMany(
    recipients.map((u) => ({
      userId: u.id,
      kind: 'session.reminder',
      title: `${session.title} starts in ${leadLabel}`,
      body: `Hosted by ${session.host.name}`,
      payload: {
        sessionId: session.id,
        scheduledStart: session.scheduledStart.toISOString(),
        scheduledEnd: session.scheduledEnd.toISOString(),
        leadTime,
      },
    }))
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Admission Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Waiting-room flow: users who don't match session visibility request
// admission; host/co-host admits or denies.

import { db } from '@/lib/db';
import { audit } from './audit';
import { sessionAudit, SESSION_AUDIT } from './session-audit';
import { AdmissionStatus, Role } from '@prisma/client';

// Admit cap — prevents pathological cases and runaway SessionInvite growth
const MAX_PENDING_PER_SESSION = 100;

export type RequestAdmissionArgs =
  | { sessionId: string; userId: string; displayName?: string }
  | { sessionId: string; guestKey: string; displayName: string };

export async function requestAdmission(args: RequestAdmissionArgs) {
  const pendingCount = await db.sessionAdmission.count({
    where: { sessionId: args.sessionId, status: AdmissionStatus.PENDING },
  });
  if (pendingCount >= MAX_PENDING_PER_SESSION) {
    throw new Error('WAITING_ROOM_FULL');
  }

  const isGuest = 'guestKey' in args;
  const existing = isGuest
    ? await db.sessionAdmission.findUnique({
        where: { sessionId_guestKey: { sessionId: args.sessionId, guestKey: args.guestKey } },
      })
    : await db.sessionAdmission.findUnique({
        where: { sessionId_userId: { sessionId: args.sessionId, userId: args.userId } },
      });

  if (existing) {
    // Re-request → reset to PENDING if previously DENIED. Already-ADMITTED
    // rows are returned as-is so the polling client can pick up the token.
    if (existing.status === AdmissionStatus.ADMITTED) return existing;
    return db.sessionAdmission.update({
      where: { id: existing.id },
      data: {
        status: AdmissionStatus.PENDING,
        displayName: args.displayName ?? existing.displayName ?? undefined,
        requestedAt: new Date(),
        decidedAt: null,
        decidedBy: null,
        denyReason: null,
      },
    });
  }

  return db.sessionAdmission.create({
    data: {
      sessionId: args.sessionId,
      userId: isGuest ? null : args.userId,
      guestKey: isGuest ? args.guestKey : null,
      displayName: args.displayName ?? null,
    },
  });
}

export async function listPending(sessionId: string) {
  // include.user is optional — guest admissions (userId null) come back with
  // `user: null` and only `displayName` to render. The sidebar UI falls back
  // to displayName + a "Guest" badge in that case.
  return db.sessionAdmission.findMany({
    where: { sessionId, status: AdmissionStatus.PENDING },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
    },
    orderBy: { requestedAt: 'asc' },
  });
}

export async function getAdmissionStatus(sessionId: string, userId: string) {
  return db.sessionAdmission.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { id: true, status: true, denyReason: true, decidedAt: true },
  });
}

export async function getGuestAdmissionStatus(sessionId: string, guestKey: string) {
  return db.sessionAdmission.findUnique({
    where: { sessionId_guestKey: { sessionId, guestKey } },
    select: { id: true, status: true, denyReason: true, decidedAt: true, displayName: true },
  });
}

/**
 * Admit a waiting user. Creates a SessionInvite so they pass visibility on the
 * next /token call. Only the host or a co-host may admit.
 */
export async function admit(args: { admissionId: string; actorId: string; actorRole: Role }) {
  const adm = await db.sessionAdmission.findUnique({
    where: { id: args.admissionId },
    include: { session: { select: { id: true, hostId: true } } },
  });
  if (!adm) throw new Error('ADMISSION_NOT_FOUND');
  if (adm.status !== AdmissionStatus.PENDING) throw new Error('ALREADY_DECIDED');

  const canDecide = await canActorDecide(adm.session.id, args.actorId, args.actorRole);
  if (!canDecide) throw new Error('NOT_AUTHORIZED');

  // Guest admissions (userId null) carry no User row to invite; the ADMITTED
  // status itself is what the guest token endpoint checks. Only registered
  // users get a SessionInvite so subsequent /token calls bypass the waiting
  // room.
  await db.$transaction(async (tx) => {
    await tx.sessionAdmission.update({
      where: { id: adm.id },
      data: {
        status: AdmissionStatus.ADMITTED,
        decidedAt: new Date(),
        decidedBy: args.actorId,
      },
    });
    if (adm.userId) {
      await tx.sessionInvite.upsert({
        where: { sessionId_userId: { sessionId: adm.session.id, userId: adm.userId } },
        create: {
          sessionId: adm.session.id,
          userId: adm.userId,
          invitedBy: args.actorId,
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
        update: { status: 'ACCEPTED', respondedAt: new Date() },
      });
    }
  });

  await audit({
    actorId: args.actorId,
    eventType: 'SESSION_ADMISSION_GRANTED',
    entityType: 'session_admission',
    entityId: adm.id,
    summary: adm.userId
      ? `Admitted user ${adm.userId}`
      : `Admitted guest ${adm.displayName ?? '(unnamed)'}`,
  });
  await sessionAudit({
    sessionId: adm.session.id,
    eventType: SESSION_AUDIT.ADMISSION_GRANTED,
    actorId: args.actorId,
    targetUserId: adm.userId ?? undefined,
  });
}

export async function deny(args: {
  admissionId: string;
  actorId: string;
  actorRole: Role;
  reason?: string;
}) {
  const adm = await db.sessionAdmission.findUnique({
    where: { id: args.admissionId },
    include: { session: { select: { id: true, hostId: true } } },
  });
  if (!adm) throw new Error('ADMISSION_NOT_FOUND');
  if (adm.status !== AdmissionStatus.PENDING) throw new Error('ALREADY_DECIDED');

  const canDecide = await canActorDecide(adm.session.id, args.actorId, args.actorRole);
  if (!canDecide) throw new Error('NOT_AUTHORIZED');

  await db.sessionAdmission.update({
    where: { id: adm.id },
    data: {
      status: AdmissionStatus.DENIED,
      decidedAt: new Date(),
      decidedBy: args.actorId,
      denyReason: args.reason ?? null,
    },
  });

  await audit({
    actorId: args.actorId,
    eventType: 'SESSION_ADMISSION_DENIED',
    entityType: 'session_admission',
    entityId: adm.id,
    summary: adm.userId
      ? `Denied user ${adm.userId}`
      : `Denied guest ${adm.displayName ?? '(unnamed)'}`,
  });
  await sessionAudit({
    sessionId: adm.session.id,
    eventType: SESSION_AUDIT.ADMISSION_DENIED,
    actorId: args.actorId,
    targetUserId: adm.userId ?? undefined,
    details: args.reason ? { reason: args.reason } : undefined,
  });
}

async function canActorDecide(sessionId: string, actorId: string, actorRole: Role): Promise<boolean> {
  if (actorRole === Role.ADMIN) return true;
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  if (!session) return false;
  if (session.hostId === actorId) return true;

  const part = await db.sessionParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId: actorId } },
    select: { role: true },
  });
  return part?.role === 'CO_HOST';
}

// ════════════════════════════════════════════════════════════════════════════
// Session Share Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// A host mints a public, no-login share link for a session. The short URL
// `/s/[token]` opens a read-only landing page (title, host, when, objectives)
// with a "sign in to attend" CTA. No account required to VIEW.
//
// Security shape mirrors RecordingShare / PromoShare:
//   - raw token returned ONCE in the create response, never stored plaintext
//   - `tokenHash` (sha256) is the lookup index
//   - the `token` column is encrypted-at-rest (decrypted only to re-show the URL)
//   - revocable; default expiry 90 days; access-counted

import { db } from '@/lib/db';
import { mintToken, hashToken, encryptToken, decryptToken } from '@/server/services/tokens';
import { Role } from '@prisma/client';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';

export class SessionShareError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'REVOKED',
    message: string,
  ) {
    super(message);
    this.name = 'SessionShareError';
  }
}

const PRIVILEGED: Role[] = [Role.ADMIN, Role.PROGRAM_DIRECTOR];
const DEFAULT_EXPIRY_DAYS = 90;

interface Actor {
  userId: string;
  role: Role;
}

async function assertCanManage(sessionId: string, actor: Actor) {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, hostId: true, proposedBy: true },
  });
  if (!session) throw new SessionShareError('NOT_FOUND', 'Session not found');
  const isPriv = PRIVILEGED.includes(actor.role);
  const isHost = session.hostId === actor.userId || session.proposedBy === actor.userId;
  if (!isPriv && !isHost) {
    throw new SessionShareError('FORBIDDEN', 'Only the host (or PD/admin) can publish a share link');
  }
  return session;
}

function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/s/${token}`;
}

export interface SessionShareLink {
  shareId: string;
  url: string;
  expiresAt: string;
}

/** Latest active (non-revoked, non-expired) share for a session, or null. */
async function getCurrentSessionShare(sessionId: string, origin: string): Promise<SessionShareLink | null> {
  const share = await db.sessionShare.findFirst({
    where: { sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, token: true, expiresAt: true },
  });
  if (!share) return null;
  const plain = decryptToken(share.token);
  if (!plain) return null; // legacy/un-decryptable row → mint a fresh one
  return { shareId: share.id, url: shareUrl(origin, plain), expiresAt: share.expiresAt.toISOString() };
}

/**
 * Create (or reuse the existing active) public share link. Re-clicking Share
 * returns the same URL rather than minting a new token each time.
 */
export async function createSessionShare(
  input: { sessionId: string; expiresInDays?: number; actor: Actor },
  origin: string,
): Promise<SessionShareLink> {
  await assertCanManage(input.sessionId, input.actor);

  const existing = await getCurrentSessionShare(input.sessionId, origin);
  if (existing) return existing;

  const days = Math.min(365, Math.max(1, input.expiresInDays ?? DEFAULT_EXPIRY_DAYS));
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const token = mintToken(24);

  const share = await db.sessionShare.create({
    data: {
      sessionId: input.sessionId,
      token: encryptToken(token),
      tokenHash: hashToken(token),
      expiresAt,
      createdById: input.actor.userId,
    },
    select: { id: true, expiresAt: true },
  });

  void audit({
    actorId: input.actor.userId,
    actorRole: input.actor.role,
    eventType: AUDIT_EVENTS.SESSION_SHARE_CREATED,
    entityType: 'SessionShare',
    entityId: share.id,
    summary: 'Public session share link created',
  }).catch(() => {});

  return { shareId: share.id, url: shareUrl(origin, token), expiresAt: share.expiresAt.toISOString() };
}

export async function revokeSessionShare(sessionId: string, actor: Actor): Promise<void> {
  await assertCanManage(sessionId, actor);
  await db.sessionShare.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export interface PublicSessionView {
  sessionId: string;
  title: string;
  description: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  hostName: string;
  hostRole: string | null;
  programLabel: string | null;
  objectives: Array<{ text: string; blooms: number }>;
  tags: string[];
  status: string;
}

/** Public, unauthenticated lookup by raw token. Bumps accessCount unless
 *  `countAccess:false` (e.g. metadata pass). Throws SessionShareError. */
export async function getPublicSessionByToken(
  token: string,
  opts?: { countAccess?: boolean },
): Promise<PublicSessionView> {
  if (!token || token.length < 16) throw new SessionShareError('NOT_FOUND', 'Invalid share link');

  const share = await db.sessionShare.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, sessionId: true, expiresAt: true, revokedAt: true },
  });
  if (!share) throw new SessionShareError('NOT_FOUND', 'Share link not found');
  if (share.revokedAt) throw new SessionShareError('REVOKED', 'This share link was revoked');
  if (share.expiresAt < new Date()) throw new SessionShareError('EXPIRED', 'This share link has expired');

  const session = await db.teachingSession.findUnique({
    where: { id: share.sessionId },
    select: {
      id: true, title: true, description: true, scheduledStart: true, scheduledEnd: true,
      objectives: true, tags: true, topicId: true, status: true, deletedAt: true,
      host: { select: { name: true, profile: { select: { subspecialty: true, affiliation: true } } } },
      program: { select: { name: true, institution: true } },
    },
  });
  if (!session || session.deletedAt) throw new SessionShareError('NOT_FOUND', 'Session no longer available');

  const objectives = Array.isArray(session.objectives)
    ? (session.objectives as Array<{ text: string; blooms: number }>).slice(0, 6)
    : [];
  const topic = session.topicId
    ? await db.topic.findUnique({ where: { id: session.topicId }, select: { name: true, subspecialty: true } })
    : null;
  const tags = [
    ...(topic?.subspecialty ? [topic.subspecialty] : []),
    ...(topic?.name ? [topic.name] : []),
    ...(session.tags ?? []),
  ].slice(0, 5);
  const programLabel = [session.program?.name, session.program?.institution].filter(Boolean).join(' · ') || null;
  const hostRole = [session.host.profile?.subspecialty, session.host.profile?.affiliation]
    .filter(Boolean).join(' · ') || session.program?.institution || null;

  if (opts?.countAccess !== false) {
    void db.sessionShare.update({
      where: { id: share.id },
      data: { accessCount: { increment: 1 }, lastAccessAt: new Date() },
    }).catch(() => {});
    void audit({
      actorId: null,
      actorRole: null,
      eventType: AUDIT_EVENTS.SESSION_SHARE_ACCESSED,
      entityType: 'SessionShare',
      entityId: share.id,
      summary: 'Public session share accessed',
    }).catch(() => {});
  }

  return {
    sessionId: session.id,
    title: session.title,
    description: session.description,
    scheduledStart: session.scheduledStart.toISOString(),
    scheduledEnd: session.scheduledEnd.toISOString(),
    hostName: session.host.name,
    hostRole,
    programLabel,
    objectives,
    tags,
    status: session.status,
  };
}

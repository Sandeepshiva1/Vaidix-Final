// ════════════════════════════════════════════════════════════════════════════
// Promo Share Service — W9
// ════════════════════════════════════════════════════════════════════════════
// Faculty mints a public-share token for an already-generated promo. The
// short URL `/p/[token]` opens a landing page showing flyer + WA banner + IG
// card previews plus session details + registration CTA. No login required.
//
// Same security shape as recording shares:
//   - raw token returned ONCE in the create response, never stored
//   - `tokenHash` (sha256) is what we index/look up
//   - revocable; default expiry 90 days from create
//   - access counts + lastAccessAt persisted for the speaker to audit

import { db } from '@/lib/db';
import { presignDownload } from '@/lib/storage';
import { mintToken, hashToken } from '@/server/services/tokens';
import { Role, DocumentRoute } from '@prisma/client';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';

export class PromoShareError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'REVOKED' | 'NO_ASSETS', message: string) {
    super(message);
  }
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const DEFAULT_EXPIRY_DAYS = 90;

export interface CreatePromoShareInput {
  sessionId: string;
  /** Optional override (days from now). Server clamps to [1, 365]. */
  expiresInDays?: number;
  actor: { userId: string; role: Role };
}

export interface CreatePromoShareResult {
  shareId: string;
  /** Raw URL token — returned to the creator ONCE. Embed in `/p/[token]`. */
  token: string;
  url: string;
  expiresAt: string;
}

/** Faculty creates a public share. Requires at least one promo asset already
 * exists on the session (call /api/promo/generate first). */
export async function createPromoShare(
  input: CreatePromoShareInput,
  origin: string
): Promise<CreatePromoShareResult> {
  if (!FACULTY_LIKE.includes(input.actor.role)) {
    throw new PromoShareError('FORBIDDEN', 'Only faculty/PD/admin can publish promo links');
  }

  const session = await db.teachingSession.findUnique({
    where: { id: input.sessionId, deletedAt: null },
    select: { id: true, hostId: true, proposedBy: true },
  });
  if (!session) throw new PromoShareError('NOT_FOUND', 'Session not found');

  const isPriv = input.actor.role === Role.ADMIN || input.actor.role === Role.PROGRAM_DIRECTOR;
  const isHost = session.hostId === input.actor.userId || session.proposedBy === input.actor.userId;
  if (!isPriv && !isHost) {
    throw new PromoShareError('FORBIDDEN', 'Only the host (or PD/admin) can publish promo links');
  }

  const assetCount = await db.document.count({
    where: {
      route: DocumentRoute.PROMO_ASSET,
      deletedAt: null,
      sessionLinks: { some: { sessionId: input.sessionId } },
    },
  });
  if (assetCount === 0) {
    throw new PromoShareError('NO_ASSETS', 'Generate promo assets before publishing a share link');
  }

  const days = Math.min(365, Math.max(1, input.expiresInDays ?? DEFAULT_EXPIRY_DAYS));
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const token = mintToken(24);

  const share = await db.promoShare.create({
    data: {
      sessionId: input.sessionId,
      token,
      tokenHash: hashToken(token),
      expiresAt,
      createdById: input.actor.userId,
    },
    select: { id: true, expiresAt: true },
  });

  return {
    shareId: share.id,
    token,
    url: `${origin.replace(/\/$/, '')}/p/${token}`,
    expiresAt: share.expiresAt.toISOString(),
  };
}

/**
 * Returns the most-recent active promo share for a session, if one exists.
 * The prep panel calls this on mount so the speaker sees their existing
 * share link instead of an empty "Generate & share" button after reload.
 *
 * Skips revoked + expired rows. Returns the latest (so re-shares supersede).
 */
export async function getCurrentPromoShareForSession(
  sessionId: string,
  actor: { userId: string; role: Role },
  origin: string
): Promise<{ shareId: string; url: string; expiresAt: string } | null> {
  if (!FACULTY_LIKE.includes(actor.role)) {
    throw new PromoShareError('FORBIDDEN', 'Only faculty/PD/admin can view promo links');
  }
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId, deletedAt: null },
    select: { hostId: true, proposedBy: true },
  });
  if (!session) throw new PromoShareError('NOT_FOUND', 'Session not found');

  const isPriv = actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR;
  const isHost = session.hostId === actor.userId || session.proposedBy === actor.userId;
  if (!isPriv && !isHost) {
    throw new PromoShareError('FORBIDDEN', 'Only the host (or PD/admin) can view promo links');
  }

  const share = await db.promoShare.findFirst({
    where: {
      sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, token: true, expiresAt: true },
  });
  if (!share) return null;
  // Legacy rows (pre-migration) have a placeholder token that won't resolve;
  // hide them so the speaker can mint a fresh, real share instead.
  if (share.token.startsWith('legacy_')) return null;
  return {
    shareId: share.id,
    url: `${origin.replace(/\/$/, '')}/p/${share.token}`,
    expiresAt: share.expiresAt.toISOString(),
  };
}

export async function revokePromoShare(
  shareId: string,
  actor: { userId: string; role: Role }
): Promise<void> {
  if (!FACULTY_LIKE.includes(actor.role)) {
    throw new PromoShareError('FORBIDDEN', 'Only faculty/PD/admin can revoke shares');
  }
  const share = await db.promoShare.findUnique({
    where: { id: shareId },
    select: {
      revokedAt: true,
      session: { select: { hostId: true, proposedBy: true } },
    },
  });
  if (!share) throw new PromoShareError('NOT_FOUND', 'Share not found');
  if (share.revokedAt) return; // idempotent

  const isPriv = actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR;
  const isHost = share.session.hostId === actor.userId || share.session.proposedBy === actor.userId;
  if (!isPriv && !isHost) {
    throw new PromoShareError('FORBIDDEN', 'Only the host can revoke this share');
  }

  await db.promoShare.update({
    where: { id: shareId },
    data: { revokedAt: new Date(), revokedById: actor.userId },
  });
}

export interface PublicPromoView {
  session: {
    title: string;
    description: string | null;
    scheduledStart: string;
    scheduledEnd: string;
    hostName: string;
    hostRole: string | null;
    programLabel: string | null;
    objectives: Array<{ text: string; blooms: number }>;
    tags: string[];
    /**
     * True ⇒ anyone with this link can join the session (the public CTA
     * surfaces a Join button). False ⇒ session is invite-only — the page
     * informs the visitor and points them at the host rather than dangling
     * a non-functional Register CTA.
     */
    openToAll: boolean;
  };
  assets: Array<{
    template: 'flyer' | 'whatsapp_banner' | 'instagram_card';
    title: string;
    /** Short-lived presigned URL for the raw SVG; safe to embed in <img>. */
    svgUrl: string;
  }>;
}

/** Public, unauthenticated lookup by raw token. Bumps accessCount as a side
 * effect by default — pass `countAccess: false` from non-render lookups
 * (e.g. Next.js generateMetadata) to avoid double-counting per page render.
 * Throws PromoShareError with non-200 codes for the route layer to translate. */
export async function getPublicPromoByToken(
  token: string,
  opts?: { countAccess?: boolean }
): Promise<PublicPromoView> {
  if (!token || token.length < 16) {
    throw new PromoShareError('NOT_FOUND', 'Invalid share link');
  }
  const tokenHash = hashToken(token);
  const share = await db.promoShare.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      sessionId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!share) throw new PromoShareError('NOT_FOUND', 'Share link not found');
  if (share.revokedAt) throw new PromoShareError('REVOKED', 'This share link was revoked');
  if (share.expiresAt < new Date()) throw new PromoShareError('EXPIRED', 'This share link has expired');

  const session = await db.teachingSession.findUnique({
    where: { id: share.sessionId },
    select: {
      title: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      objectives: true,
      tags: true,
      topicId: true,
      openToAll: true,
      host: {
        select: {
          name: true,
          profile: { select: { subspecialty: true, affiliation: true } },
        },
      },
      program: { select: { name: true, institution: true } },
    },
  });
  if (!session) throw new PromoShareError('NOT_FOUND', 'Session no longer available');

  const objectivesArr = Array.isArray(session.objectives)
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
    .filter(Boolean)
    .join(' · ') || session.program?.institution || null;

  const assetDocs = await db.document.findMany({
    where: {
      route: DocumentRoute.PROMO_ASSET,
      deletedAt: null,
      sessionLinks: { some: { sessionId: share.sessionId } },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, s3Key: true },
  });

  // Take the most-recent of each template (title contains "flyer" / "whatsapp banner" / "instagram card").
  function templateOf(title: string): PublicPromoView['assets'][number]['template'] | null {
    const lower = title.toLowerCase();
    if (lower.includes('flyer')) return 'flyer';
    if (lower.includes('whatsapp')) return 'whatsapp_banner';
    if (lower.includes('instagram')) return 'instagram_card';
    return null;
  }
  const latestByTemplate = new Map<string, (typeof assetDocs)[number]>();
  for (const d of assetDocs) {
    const t = templateOf(d.title);
    if (!t) continue;
    if (!latestByTemplate.has(t)) latestByTemplate.set(t, d);
  }

  const assets: PublicPromoView['assets'] = [];
  for (const template of ['flyer', 'whatsapp_banner', 'instagram_card'] as const) {
    const d = latestByTemplate.get(template);
    if (!d) continue;
    const svgUrl = await presignDownload(d.s3Key, 60 * 30); // 30 min
    assets.push({ template, title: d.title, svgUrl });
  }

  // Side-effect: bump access counters. Done after fetch so a failed read
  // does not corrupt analytics. Fire-and-forget so a single broken row does
  // not break the public page. Skipped by callers that hit this just to
  // build OpenGraph metadata (the same render bumps via the main fetch).
  if (opts?.countAccess !== false) {
    void db.promoShare
      .update({
        where: { id: share.id },
        data: { accessCount: { increment: 1 }, lastAccessAt: new Date() },
      })
      .catch(() => {});
    // Best-effort audit. Actor is unauthenticated (left null on the row);
    // the entityId pins this to the share so the speaker can see views.
    void audit({
      actorId: null,
      actorRole: null,
      eventType: AUDIT_EVENTS.PROMO_SHARE_ACCESSED,
      entityType: 'PromoShare',
      entityId: share.id,
      summary: 'Public promo share accessed',
    }).catch(() => {});
  }

  return {
    session: {
      title: session.title,
      description: session.description,
      scheduledStart: session.scheduledStart.toISOString(),
      scheduledEnd: session.scheduledEnd.toISOString(),
      hostName: session.host.name,
      hostRole,
      programLabel,
      objectives: objectivesArr,
      tags,
      openToAll: session.openToAll,
    },
    assets,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Recording Share Service — W5
// ════════════════════════════════════════════════════════════════════════════
// Generate share links for a recording. Optional bcrypt-hashed password,
// configurable expiry (default 7 days, max 30 days), revocation, and full
// access logging to RecordingShareAccess + AuditEvent.
//
// Token is a 32-byte hex random ID. The raw value is what the user receives
// in the share URL — but it is NEVER stored at rest. We persist sha256(token)
// in `tokenHash` and look up by that, so a DB dump cannot be replayed as a
// share link. (HARDENING-PLAN item #12.)

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { mintToken, hashToken } from '@/server/services/tokens';
import { presignDownload } from '@/lib/storage';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { mintSharePlaybackToken } from '@/server/services/recordings/share-playback-token';

export class RecordingShareError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'INVALID'
      | 'EXPIRED'
      | 'REVOKED'
      | 'WRONG_PASSWORD'
      | 'PASSWORD_REQUIRED',
    message: string
  ) {
    super(message);
  }
}

export interface ShareActor {
  userId: string;
  role: Role;
}

const DEFAULT_TTL_DAYS = 7;
const MAX_TTL_DAYS = 30;

async function userCanShareRecording(actor: ShareActor, recordingId: string): Promise<boolean> {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) return true;
  const recording = await db.recording.findUnique({
    where: { id: recordingId },
    select: { session: { select: { hostId: true, proposedBy: true } } },
  });
  if (!recording) return false;
  return (
    recording.session.hostId === actor.userId || recording.session.proposedBy === actor.userId
  );
}

export interface CreateShareInput {
  recordingId: string;
  ttlDays?: number;
  password?: string;
}

export async function createShare(
  actor: ShareActor,
  input: CreateShareInput
): Promise<{ id: string; token: string; expiresAt: string; hasPassword: boolean }> {
  if (!(await userCanShareRecording(actor, input.recordingId))) {
    throw new RecordingShareError('FORBIDDEN', 'Only host, PD, or admin can share');
  }
  const ttlDays = Math.min(
    Math.max(1, Math.floor(input.ttlDays ?? DEFAULT_TTL_DAYS)),
    MAX_TTL_DAYS
  );
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 3600 * 1000);
  const token = mintToken(32);
  const tokenHash = hashToken(token);
  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;

  const share = await db.recordingShare.create({
    data: {
      recordingId: input.recordingId,
      tokenHash,
      passwordHash,
      expiresAt,
      createdById: actor.userId,
    },
    select: { id: true, expiresAt: true, passwordHash: true },
  });

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    eventType: AUDIT_EVENTS.RECORDING_SHARE_CREATED,
    entityType: 'RecordingShare',
    entityId: share.id,
    details: { recordingId: input.recordingId, ttlDays, hasPassword: !!passwordHash },
  });

  return {
    id: share.id,
    // Raw token is returned ONCE here (caller wraps it into the URL).
    // We never persist or read it again from DB.
    token,
    expiresAt: share.expiresAt.toISOString(),
    hasPassword: !!share.passwordHash,
  };
}

export async function listSharesForRecording(
  actor: ShareActor,
  recordingId: string
): Promise<
  Array<{
    id: string;
    expiresAt: string;
    revokedAt: string | null;
    accessCount: number;
    lastAccessAt: string | null;
    hasPassword: boolean;
    createdAt: string;
  }>
> {
  if (!(await userCanShareRecording(actor, recordingId))) {
    throw new RecordingShareError('FORBIDDEN', 'No access');
  }
  const rows = await db.recordingShare.findMany({
    where: { recordingId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    accessCount: r.accessCount,
    lastAccessAt: r.lastAccessAt?.toISOString() ?? null,
    hasPassword: !!r.passwordHash,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function revokeShare(actor: ShareActor, shareId: string): Promise<void> {
  const share = await db.recordingShare.findUnique({
    where: { id: shareId },
    select: { id: true, recordingId: true, revokedAt: true },
  });
  if (!share) throw new RecordingShareError('NOT_FOUND', 'Share not found');
  if (share.revokedAt) return;
  if (!(await userCanShareRecording(actor, share.recordingId))) {
    throw new RecordingShareError('FORBIDDEN', 'No permission to revoke');
  }
  await db.recordingShare.update({
    where: { id: shareId },
    data: { revokedAt: new Date(), revokedById: actor.userId },
  });
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    eventType: AUDIT_EVENTS.RECORDING_SHARE_REVOKED,
    entityType: 'RecordingShare',
    entityId: shareId,
  });
}

export interface AccessShareResult {
  recordingId: string;
  hlsUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  expiresAt: string;
}

export async function accessShare(
  token: string,
  password: string | undefined,
  meta: { ipAddress: string | null; userAgent: string | null }
): Promise<AccessShareResult> {
  const share = await db.recordingShare.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      recording: {
        select: {
          id: true,
          status: true,
          hlsPath: true,
          thumbnailUrl: true,
          durationSec: true,
          expungedAt: true,
        },
      },
    },
  });
  if (!share) throw new RecordingShareError('NOT_FOUND', 'Invalid share link');

  // Always log the attempt — both successful and failed.
  const logFail = async (reason: string) => {
    await db.recordingShareAccess.create({
      data: {
        shareId: share.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        succeeded: false,
        failReason: reason,
      },
    });
    await audit({
      eventType: AUDIT_EVENTS.RECORDING_SHARE_BLOCKED,
      entityType: 'RecordingShare',
      entityId: share.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      success: false,
      details: { reason },
    });
  };

  if (share.revokedAt) {
    await logFail('REVOKED');
    throw new RecordingShareError('REVOKED', 'This share link has been revoked');
  }
  if (share.expiresAt.getTime() < Date.now()) {
    await logFail('EXPIRED');
    throw new RecordingShareError('EXPIRED', 'This share link has expired');
  }
  if (share.passwordHash) {
    if (!password) {
      await logFail('PASSWORD_REQUIRED');
      throw new RecordingShareError('PASSWORD_REQUIRED', 'Password required');
    }
    const match = await bcrypt.compare(password, share.passwordHash);
    if (!match) {
      await logFail('WRONG_PASSWORD');
      throw new RecordingShareError('WRONG_PASSWORD', 'Wrong password');
    }
  }
  if (!share.recording || share.recording.expungedAt) {
    await logFail('RECORDING_GONE');
    throw new RecordingShareError('NOT_FOUND', 'Recording is no longer available');
  }
  if (share.recording.status !== 'READY') {
    await logFail('NOT_READY');
    throw new RecordingShareError('INVALID', 'Recording not ready for playback');
  }

  // Success — increment counters, log access, mint signed HLS URL.
  await db.$transaction(async (tx) => {
    await tx.recordingShareAccess.create({
      data: {
        shareId: share.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        succeeded: true,
      },
    });
    await tx.recordingShare.update({
      where: { id: share.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessAt: new Date(),
      },
    });
  });

  await audit({
    eventType: AUDIT_EVENTS.RECORDING_SHARE_ACCESSED,
    entityType: 'RecordingShare',
    entityId: share.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    details: { recordingId: share.recording.id },
  });

  // HLS is served through an authenticated proxy keyed by a short-lived
  // playback token (verifies password gate was passed). Thumbnail is a single
  // image so a presigned URL is fine.
  const playbackToken = share.recording.hlsPath
    ? mintSharePlaybackToken(share.id, share.expiresAt)
    : null;
  const hlsUrl = playbackToken
    ? `/api/recordings/share-play/${playbackToken}/hls/master.m3u8`
    : null;
  const thumbnailUrl = share.recording.thumbnailUrl
    ? await presignDownload(share.recording.thumbnailUrl, 6 * 3600).catch(() => null)
    : null;

  return {
    recordingId: share.recording.id,
    hlsUrl,
    thumbnailUrl,
    durationSec: share.recording.durationSec,
    expiresAt: share.expiresAt.toISOString(),
  };
}

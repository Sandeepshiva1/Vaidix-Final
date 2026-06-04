// ════════════════════════════════════════════════════════════════════════════
// Notifications Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Reads from the Notification table for the bell/inbox UI (list, ack).
// Also exports `emit()` — a fire-and-forget helper used by domain services
// (session-notifications, pre-questions, invitation, objectives, transcribe)
// to write IN_APP rows without coupling to the full Prisma import shape.

import { db } from '@/lib/db';
import { NotificationChannel } from '@prisma/client';
import type { Prisma } from '@prisma/client';

// ─── Emit helper ─────────────────────────────────────────────────────────────
// Fire-and-forget: swallows errors so a notification failure never blocks the
// primary business transaction. Callers must be in a non-transactional context
// (outside db.$transaction) since we use the global db client.

export interface EmitInput {
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  payload?: Prisma.InputJsonValue;
}

export async function emit(input: EmitInput): Promise<void> {
  try {
    await db.notification.create({
      data: {
        userId: input.userId,
        channel: NotificationChannel.IN_APP,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        payload: input.payload ?? {},
      },
    });
  } catch (err) {
    console.error('[notifications] emit failed', { kind: input.kind, userId: input.userId, err: (err as Error).message });
  }
}

// Bulk variant — one INSERT per user, parallel. Same fire-and-forget contract.
export async function emitToMany(inputs: EmitInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await Promise.all(inputs.map(emit));
}

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: Prisma.JsonValue;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationView[];
  unreadCount: number;
}

// kind → deep-link resolver. Kept here so the client doesn't have to
// replicate the mapping. Returns null when the row is purely informational.
function resolveLinkUrl(kind: string, payload: Prisma.JsonValue): string | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const sessionId = typeof p.sessionId === 'string' ? p.sessionId : null;
  const approvalUrl = typeof p.approvalUrl === 'string' ? p.approvalUrl : null;

  switch (kind) {
    case 'session.proposed':
      return approvalUrl ?? '/inbox/approvals';
    case 'session.rejected':
      return '/calendar';
    case 'session.approved':
    case 'session.rescheduled':
    case 'session.cancelled':
    case 'session.reminder':
    case 'session.started':
      return sessionId ? `/classroom/${sessionId}` : '/calendar';
    case 'session.ended':
      // Deep-link to the recording page — by the time the user clicks the
      // bell, the transcribe-worker has usually run and the playback view is
      // the most useful destination.
      return sessionId ? `/classroom/${sessionId}/recording` : '/calendar';
    case 'prequestion.posted':
      return sessionId ? `/classroom/${sessionId}/pre-questions/dashboard` : null;
    case 'invitation.accepted':
      return '/admin/users';
    case 'objective.achieved':
      return sessionId ? `/classroom/${sessionId}` : null;
    case 'recording.ready':
      return sessionId ? `/classroom/${sessionId}/recording` : null;
    default:
      return sessionId ? `/classroom/${sessionId}` : null;
  }
}

function toView(row: {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    payload: row.payload,
    linkUrl: resolveLinkUrl(row.kind, row.payload),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listForUser(
  userId: string,
  opts: { onlyUnread?: boolean; limit?: number } = {}
): Promise<NotificationListResult> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: {
        userId,
        channel: 'IN_APP',
        ...(opts.onlyUnread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        payload: true,
        readAt: true,
        createdAt: true,
      },
    }),
    db.notification.count({
      where: { userId, channel: 'IN_APP', readAt: null },
    }),
  ]);
  return { items: rows.map(toView), unreadCount };
}

export async function markRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

// ─── Notification Preferences ─────────────────────────────────────────────────

export const KNOWN_NOTIFICATION_KINDS = [
  'session.proposed',
  'session.approved',
  'session.rejected',
  'session.rescheduled',
  'session.cancelled',
  'session.reminder',
  'session.started',
  'session.ended',
  'prequestion.posted',
  'invitation.accepted',
  'objective.achieved',
  'recording.ready',
] as const;

export interface PreferenceView {
  kind: string;
  channel: string;
  enabled: boolean;
}

export async function getPreferences(userId: string): Promise<PreferenceView[]> {
  const rows = await db.notificationPreference.findMany({
    where: { userId, channel: NotificationChannel.IN_APP },
    select: { kind: true, channel: true, enabled: true },
  });
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return KNOWN_NOTIFICATION_KINDS.map((kind) => ({
    kind,
    channel: NotificationChannel.IN_APP,
    enabled: byKind.get(kind)?.enabled ?? true,
  }));
}

export async function upsertPreference(
  userId: string,
  kind: string,
  channel: NotificationChannel,
  enabled: boolean
): Promise<PreferenceView> {
  const row = await db.notificationPreference.upsert({
    where: { userId_kind_channel: { userId, kind, channel } },
    create: { userId, kind, channel, enabled },
    update: { enabled },
    select: { kind: true, channel: true, enabled: true },
  });
  return { kind: row.kind, channel: row.channel, enabled: row.enabled };
}

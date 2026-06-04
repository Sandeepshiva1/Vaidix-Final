// ════════════════════════════════════════════════════════════════════════════
// Session Audit — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Thin wrapper around SessionAuditEvent model. Per-session audit trail
// complementary to the global AuditEvent stream.

import { db } from '@/lib/db';

export const SESSION_AUDIT = {
  // Lifecycle / moderation (audit-only, tMs=null)
  SESSION_STARTED: 'SESSION_STARTED',
  SESSION_ENDED: 'SESSION_ENDED',
  PARTICIPANT_JOINED: 'JOIN',
  PARTICIPANT_LEFT: 'LEAVE',
  PARTICIPANT_MUTED: 'MUTE',
  PARTICIPANT_UNMUTED: 'UNMUTE',
  PARTICIPANT_KICKED: 'KICK',
  PARTICIPANT_BANNED: 'BAN',
  COHOST_PROMOTED: 'COHOST_PROMOTED',
  COHOST_DEMOTED: 'COHOST_DEMOTED',
  ADMISSION_GRANTED: 'ADMISSION_GRANTED',
  ADMISSION_DENIED: 'ADMISSION_DENIED',
  SCREEN_SHARE_START: 'SCREEN_SHARE_START',
  SCREEN_SHARE_STOP: 'SCREEN_SHARE_STOP',

  // Replay events. Written via /api/classroom/sessions/[id]/events with a
  // server-assigned tMs offset so the recording viewer can replay them in
  // sync with the video timeline. See REPLAYABLE_EVENT_TYPES below for the
  // subset that the events endpoint accepts (some — e.g. SPOTLIGHT_SET — are
  // host-only and server enforces the role gate).
  REACTION: 'REACTION', // details: { emoji }
  SPOTLIGHT_SET: 'SPOTLIGHT_SET', // host-only; targetUserId required
  SPOTLIGHT_CLEAR: 'SPOTLIGHT_CLEAR', // host-only
  PIN_SET: 'PIN_SET', // local-only — written for replay history; targetUserId
  PIN_CLEAR: 'PIN_CLEAR',
  NOTE_EDIT: 'NOTE_EDIT', // beacon — actual content lives in SharedNoteEdit
  FILE_SHARE: 'FILE_SHARE', // beacon — actual file lives in SessionFile
  NOISE_SUPPRESSION_TOGGLE: 'NOISE_SUPPRESSION_TOGGLE', // details: { enabled, tier?: 'krisp' | 'browser' | 'off' | 'unsupported' }
  BG_BLUR_TOGGLE: 'BG_BLUR_TOGGLE', // details: { mode, strength?, src? }
  PIP_TOGGLE: 'PIP_TOGGLE', // details: { enabled }
  POP_OUT: 'POP_OUT', // details: { surface }
  WEBINAR_JOIN: 'WEBINAR_JOIN', // details: { name, email } — pre-User row

  // Screen-share annotation strokes (Phase 3). One event per stroke commit;
  // payload carries the tldraw shape record so the live overlay + recording
  // viewer can re-render without rehydrating a full whiteboard. Cleared
  // implicitly when the host stops sharing (the annotation overlay unmounts;
  // we don't write a CLEAR event).
  // details: { shape, screenShareTrackSid }
  ANNOTATION_DRAW: 'ANNOTATION_DRAW',
  ANNOTATION_CLEAR: 'ANNOTATION_CLEAR', // host wipes the canvas mid-share
} as const;

export type SessionAuditEventType = (typeof SESSION_AUDIT)[keyof typeof SESSION_AUDIT];

/**
 * The subset of audit event types accepted by the public /events endpoint.
 * Lifecycle events (JOIN, KICK, etc.) stay server-only — they are emitted by
 * the token route, mute route, end-session route, etc.
 */
export const REPLAYABLE_EVENT_TYPES = new Set<SessionAuditEventType>([
  SESSION_AUDIT.REACTION,
  SESSION_AUDIT.SPOTLIGHT_SET,
  SESSION_AUDIT.SPOTLIGHT_CLEAR,
  SESSION_AUDIT.PIN_SET,
  SESSION_AUDIT.PIN_CLEAR,
  SESSION_AUDIT.NOTE_EDIT,
  SESSION_AUDIT.FILE_SHARE,
  SESSION_AUDIT.NOISE_SUPPRESSION_TOGGLE,
  SESSION_AUDIT.BG_BLUR_TOGGLE,
  SESSION_AUDIT.PIP_TOGGLE,
  SESSION_AUDIT.POP_OUT,
  SESSION_AUDIT.ANNOTATION_DRAW,
  SESSION_AUDIT.ANNOTATION_CLEAR,
]);

/**
 * Event types only the host or co-host can emit. Enforced in /events POST.
 */
export const HOST_ONLY_EVENT_TYPES = new Set<SessionAuditEventType>([
  SESSION_AUDIT.SPOTLIGHT_SET,
  SESSION_AUDIT.SPOTLIGHT_CLEAR,
  SESSION_AUDIT.ANNOTATION_DRAW,
  SESSION_AUDIT.ANNOTATION_CLEAR,
]);

export async function sessionAudit(args: {
  sessionId: string;
  eventType: SessionAuditEventType;
  actorId?: string | null;
  targetUserId?: string | null;
  details?: Record<string, unknown> | null;
  /// Offset from recording start in ms; null for lifecycle/moderation events.
  tMs?: number | null;
}): Promise<void> {
  try {
    await db.sessionAuditEvent.create({
      data: {
        sessionId: args.sessionId,
        eventType: args.eventType,
        actorId: args.actorId ?? null,
        targetUserId: args.targetUserId ?? null,
        details: args.details ? (args.details as object) : undefined,
        tMs: args.tMs ?? null,
      },
    });
  } catch (err) {
    console.error('[session-audit] failed:', err, 'event:', args.eventType);
  }
}

/**
 * Compute the server-side tMs offset for a replay event based on the
 * session's recording start time (or actualStart fallback). Returns null when
 * neither anchor is available — the audit row still lands but won't replay.
 */
export async function computeTMs(sessionId: string): Promise<number | null> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      actualStart: true,
      recording: { select: { startedAtRoom: true } },
    },
  });
  if (!session) return null;
  const anchor = session.recording?.startedAtRoom ?? session.actualStart;
  if (!anchor) return null;
  return Date.now() - anchor.getTime();
}

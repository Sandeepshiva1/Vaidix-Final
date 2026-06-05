// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/webhooks/livekit
// ════════════════════════════════════════════════════════════════════════════
// Receives signed LiveKit webhook events:
//   - Room lifecycle: room_started / room_finished / participant_joined/left
//   - Egress lifecycle: egress_started / egress_updated /
//     egress_ended — drives the recording state machine and enqueues transcode.
// Updates session + recording records without trusting any client state.

import { webhookReceiver, startSessionEgress } from '@/lib/livekit';
import { TrackSource } from '@livekit/protocol';
import { db } from '@/lib/db';
import { getQueue, QUEUES } from '@/lib/queue';
import { SessionStatus, RecordingStatus } from '@prisma/client';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { maybeFlipToLive } from '@/server/services/session-service';

const ROOM_SESSION_PREFIX = 'session-';

function roomToSessionId(roomName: string | undefined): string | null {
  if (!roomName) return null;
  if (!roomName.startsWith(ROOM_SESSION_PREFIX)) return null;
  return roomName.slice(ROOM_SESSION_PREFIX.length);
}

// LiveKit Egress event payload shape (subset used here).
// IMPORTANT: `status` is the numeric `EgressStatus` enum from @livekit/protocol
// at runtime (not a string!). The protobuf JSON decoder maps the string name
// (e.g. "EGRESS_ABORTED") to the numeric enum value (5). Earlier versions of
// this handler compared `status` to string literals and silently no-op'd —
// recordings stayed in the RECORDING state forever after a failed egress.
// Use `egressStatusName()` to normalize to the canonical string name.
interface EgressEventPayload {
  egressInfo?: {
    egressId?: string;
    roomName?: string;
    status?: number | string;
    file?: { filename?: string; location?: string };
    fileResults?: Array<{ filename?: string; location?: string; size?: string | number; duration?: string | number }>;
    error?: string;
  };
}

// EgressStatus enum from livekit/protocol (proto3 numeric values).
const EGRESS_STATUS_NAMES: Record<number, string> = {
  0: 'EGRESS_STARTING',
  1: 'EGRESS_ACTIVE',
  2: 'EGRESS_ENDING',
  3: 'EGRESS_COMPLETE',
  4: 'EGRESS_FAILED',
  5: 'EGRESS_ABORTED',
  6: 'EGRESS_LIMIT_REACHED',
};

function egressStatusName(status: number | string | undefined): string {
  if (typeof status === 'string') return status;
  if (typeof status === 'number') return EGRESS_STATUS_NAMES[status] ?? '';
  return '';
}

function pickEgressFile(info: NonNullable<EgressEventPayload['egressInfo']>): { key: string | null; sizeBytes: bigint | null; durationSec: number | null } {
  const fr = info.fileResults?.[0];
  const fname = fr?.filename ?? info.file?.filename ?? null;
  // LiveKit Egress writes path-style filenames; we store as MinIO key.
  // Strip the bucket prefix if Egress was configured with a leading slash.
  const key = fname ? fname.replace(/^\//, '') : null;
  const sizeRaw = fr?.size;
  // LiveKit reports size/duration as int64 → a *bigint* in current SDKs (older
  // ones used string/number). Math.round() throws on a bigint ("Cannot convert
  // a BigInt value to a number"), which is what broke every egress_ended
  // webhook. Handle all three shapes.
  const sizeBytes = sizeRaw == null
    ? null
    : typeof sizeRaw === 'bigint'
      ? sizeRaw
      : BigInt(typeof sizeRaw === 'string' ? sizeRaw : Math.round(sizeRaw));
  const durationRaw = fr?.duration;
  // Duration is nanoseconds when it's a bigint (int64) or a long numeric string;
  // older builds occasionally report whole seconds as a short string.
  const durationSec = durationRaw == null
    ? null
    : Math.round(
        Number(durationRaw) /
          (typeof durationRaw === 'bigint' ||
          (typeof durationRaw === 'string' && durationRaw.length > 7)
            ? 1_000_000_000
            : 1),
      );
  return { key, sizeBytes, durationSec };
}

/**
 * Start recording for `sessionId` iff:
 *   1. The session has `recordingEnabled = true`
 *   2. We have not already triggered an egress for it (idempotency)
 *
 * Does NOT throw. All failure modes are audited and the function returns
 * normally — webhook delivery must succeed even if recording cannot start.
 */
async function maybeStartRecording(sessionId: string): Promise<void> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, recordingEnabled: true, deletedAt: true },
  });
  if (!session || session.deletedAt) return;
  if (!session.recordingEnabled) return;

  // Idempotency: skip only when an egress is *currently in flight*. Earlier
  // versions skipped on any pre-existing Recording row, which meant a session
  // that had failed once (e.g. EGRESS_ABORTED — no media) could never be
  // re-recorded on a re-join. Now we only short-circuit when the prior egress
  // is in an active state; failure / cancellation states are explicitly
  // retryable so a host can re-enter the room and try again.
  const ACTIVE_STATES = new Set<RecordingStatus>([
    RecordingStatus.RECORDING,
    RecordingStatus.RECORDING_PARTIAL,
    RecordingStatus.TRANSCODING,
    RecordingStatus.TRANSCRIBING,
    RecordingStatus.AI_PROCESSING,
    RecordingStatus.READY,
  ]);
  const existing = await db.recording.findUnique({
    where: { sessionId },
    select: { id: true, egressJobId: true, status: true },
  });
  if (existing && existing.egressJobId && ACTIVE_STATES.has(existing.status)) return;

  try {
    const { egressId, filepath } = await startSessionEgress(sessionId);
    // Pre-seed the Recording row so it's discoverable even before the
    // egress_started webhook reaches us. On retry (previous attempt was
    // RECORDING_FAILED / CANCELLED) we reset all failure metadata so the UI
    // doesn't keep showing the stale "No media captured" banner.
    await db.recording.upsert({
      where: { sessionId },
      create: {
        sessionId,
        status: RecordingStatus.RECORDING,
        pipelineStage: RecordingStatus.RECORDING,
        egressJobId: egressId,
      },
      update: {
        status: RecordingStatus.RECORDING,
        pipelineStage: RecordingStatus.RECORDING,
        egressJobId: egressId,
        failureReason: null,
        rawS3Key: null,
        hlsPath: null,
        durationSec: null,
        retryCount: { increment: 1 },
      },
    });
    await audit({
      eventType: AUDIT_EVENTS.RECORDING_EGRESS_STARTED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: 'Recording egress requested',
      details: { sessionId, egressId, filepath },
    });
  } catch (err) {
    // Don't fail the webhook: live class continues without recording.
    console.error('[livekit-webhook] failed to start egress for session', sessionId, err);
    await audit({
      eventType: AUDIT_EVENTS.RECORDING_EGRESS_FAILED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: 'Failed to start recording egress',
      details: { sessionId, error: (err as Error).message },
      success: false,
    });
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const authHeader = req.headers.get('authorization') ?? '';

  let event;
  try {
    event = await webhookReceiver.receive(raw, authHeader);
  } catch (err) {
    console.error('[livekit-webhook] signature verification failed:', err);
    return new Response('Invalid signature', { status: 401 });
  }

  // ─── Egress events: derive sessionId from the egress payload room ───────
  const egressInfo = (event as unknown as EgressEventPayload).egressInfo;
  if (egressInfo) {
    const sessionId = roomToSessionId(egressInfo.roomName);
    if (!sessionId) return new Response('OK (egress no-op)', { status: 200 });

    const status = egressStatusName(egressInfo.status);
    try {
      // Egress started — ensure a Recording row exists.
      if (event.event === 'egress_started' || status === 'EGRESS_ACTIVE') {
        await db.recording.upsert({
          where: { sessionId },
          create: {
            sessionId,
            status: RecordingStatus.RECORDING,
            pipelineStage: RecordingStatus.RECORDING,
            egressJobId: egressInfo.egressId ?? null,
          },
          update: {
            status: RecordingStatus.RECORDING,
            pipelineStage: RecordingStatus.RECORDING,
            egressJobId: egressInfo.egressId ?? null,
          },
        });
        const recId = (await db.recording.findUnique({ where: { sessionId }, select: { id: true } }))!.id;
        await db.recordingStageEvent.create({
          data: {
            recordingId: recId,
            stage: RecordingStatus.RECORDING,
            metadata: { egressId: egressInfo.egressId ?? null },
          },
        });
        await audit({
          eventType: AUDIT_EVENTS.RECORDING_EGRESS_STARTED,
          entityType: 'Recording',
          entityId: recId,
          summary: 'Egress recording started',
          details: { sessionId, egressId: egressInfo.egressId ?? null },
        });
      }

      // Egress complete — write rawS3Key, advance to TRANSCODING, enqueue worker.
      if (event.event === 'egress_ended' && status === 'EGRESS_COMPLETE') {
        const { key, sizeBytes, durationSec } = pickEgressFile(egressInfo);
        const recording = await db.recording.update({
          where: { sessionId },
          data: {
            rawS3Key: key,
            sizeBytes,
            durationSec,
            status: RecordingStatus.TRANSCODING,
            pipelineStage: RecordingStatus.TRANSCODING,
            transcodeStartedAt: new Date(),
          },
        });
        await db.recordingStageEvent.create({
          data: {
            recordingId: recording.id,
            stage: RecordingStatus.TRANSCODING,
            metadata: { rawKey: key ?? null, egressId: egressInfo.egressId ?? null },
          },
        });
        await getQueue(QUEUES.RECORDING).add(
          'transcode',
          { recordingId: recording.id },
          { jobId: `transcode-${recording.id}` }
        );
        await audit({
          eventType: AUDIT_EVENTS.RECORDING_EGRESS_COMPLETED,
          entityType: 'Recording',
          entityId: recording.id,
          summary: 'Egress recording uploaded; transcode enqueued',
          details: { sessionId, key, sizeBytes: sizeBytes?.toString() ?? null, durationSec },
        });
      }

      // Egress failed/aborted — record failure.
      if (event.event === 'egress_ended' && (status === 'EGRESS_FAILED' || status === 'EGRESS_ABORTED')) {
        await db.recording.updateMany({
          where: { sessionId },
          data: {
            status: RecordingStatus.RECORDING_FAILED,
            pipelineStage: RecordingStatus.RECORDING_FAILED,
            failureReason: egressInfo.error ?? `Egress ${status}`,
          },
        });
        await audit({
          eventType: AUDIT_EVENTS.RECORDING_EGRESS_FAILED,
          entityType: 'TeachingSession',
          entityId: sessionId,
          summary: `Egress ${status}`,
          details: { sessionId, error: egressInfo.error ?? null, status },
          success: false,
        });
      }
    } catch (err) {
      console.error('[livekit-webhook] egress handler error:', err, 'event:', event.event);
      return new Response('Handler error', { status: 500 });
    }

    return new Response('OK', { status: 200 });
  }

  // ─── Room lifecycle events (existing logic) ─────────────────────────
  const sessionId = roomToSessionId(event.room?.name);
  if (!sessionId) {
    return new Response('OK (no-op)', { status: 200 });
  }

  try {
    switch (event.event) {
      case 'room_started': {
        // Capture the LiveKit room SID regardless of pre-flight vs in-window —
        // the SID is just a handle for later operations (egress, mute, etc.)
        // and stamping it doesn't imply the class has started.
        if (event.room?.sid) {
          await db.teachingSession.updateMany({
            where: { id: sessionId, liveKitRoomSid: null },
            data: { liveKitRoomSid: event.room.sid },
          });
        }

        // Status flip is gated to the scheduled window. Outside the window
        // this room_started is a pre-flight test — the host is just opening
        // the room early to A/V check. Status stays SCHEDULED, no LIVE pill.
        //
        // NOTE on recording: we intentionally do NOT start egress here.
        // `room_started` fires the instant the first WebSocket handshake
        // completes — before the browser has finished getUserMedia, ICE
        // negotiation, or published any track. If we kick off the egress
        // bot at this moment it joins an empty room, waits ~15s for media
        // that hasn't arrived yet, and aborts with "Start signal not
        // received" (LiveKit egress error code 412). Egress only succeeds
        // when there's actually media flowing, so the trigger lives in
        // `track_published` below — that event guarantees at least one
        // participant is sending audio/video at the moment we dispatch.
        await maybeFlipToLive(sessionId, null);
        break;
      }
      case 'room_finished': {
        await db.teachingSession.updateMany({
          where: { id: sessionId, status: SessionStatus.LIVE },
          data: {
            status: SessionStatus.ENDED,
            actualEnd: new Date(),
          },
        });
        // Stamp any still-open participant rows
        await db.sessionParticipant.updateMany({
          where: { sessionId, leftAt: null },
          data: { leftAt: new Date() },
        });
        break;
      }
      case 'participant_joined': {
        const userId = event.participant?.identity;
        if (!userId) break;
        // Egress recorder bot joins as a participant too — its identity is the
        // egressId (EG_*). Don't track it as a real attendee.
        if (userId.startsWith('EG_')) break;
        // Anonymous guests get the identity `guest_<admissionId>` (see
        // /api/classroom/sessions/[id]/guest/route.ts:149). There is no
        // corresponding User row for them — guests are tracked in
        // SessionAdmission (with a nullable userId + guestKey, added in
        // migration 20260514000000_session_admission_guest_support). Trying
        // to write them into SessionParticipant violates the FK constraint
        // `session_participants_userId_fkey` and spams the app log on every
        // guest join. Skip cleanly.
        if (userId.startsWith('guest_')) break;
        // Resolve the participant's role at join time so SessionParticipant
        // captures it (HOST / FACULTY / RESIDENT / etc.). If the User row
        // has been deleted in the meantime, also skip — the FK would fail.
        const u = await db.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!u) break;
        // Upsert so we record joins even if there was no pre-created row
        // (e.g. an open-to-all session where attendance wasn't pre-seeded).
        // The unique constraint on (sessionId, userId) makes this idempotent.
        await db.sessionParticipant.upsert({
          where: { sessionId_userId: { sessionId, userId } },
          create: {
            sessionId,
            userId,
            role: u.role,
            joinedAt: new Date(),
            livekitIdentity: userId,
          },
          update: {
            joinedAt: new Date(),
            leftAt: null, // re-join: clear the old leave timestamp
            livekitIdentity: userId,
          },
        });
        // Catch-up: a host may have opened the room early (pre-flight, status
        // stayed SCHEDULED). Once a participant arrives *and* the window is
        // open, this is the moment to flip status to LIVE. Also handles
        // recurring sessions where the master row is ENDED from a prior
        // occurrence — `maybeFlipToLive` allows ENDED→LIVE for recurring.
        //
        // Recording is intentionally NOT triggered here. See the note in
        // the `room_started` case above — getUserMedia + ICE haven't
        // completed at participant_joined time, so egress would join an
        // empty room and abort. Recording fires from `track_published`.
        await maybeFlipToLive(sessionId, userId);
        break;
      }
      case 'participant_left': {
        const userId = event.participant?.identity;
        if (!userId) break;
        await db.sessionParticipant.updateMany({
          where: { sessionId, userId, leftAt: null },
          data: { leftAt: new Date() },
        });
        break;
      }
      case 'track_published': {
        // Only start egress when a camera track is published. Room composite
        // egress requires at least one video track within ~15 s of joining or
        // it aborts with "Start signal not received" (code 412). Triggering on
        // microphone tracks caused an infinite retry storm: mic published →
        // egress started → waited 15 s for video → RECORDING_FAILED written →
        // next mic event fired → RECORDING_FAILED not in ACTIVE_STATES →
        // new egress dispatched → repeat every 15-30 s.
        //
        // Screen-share (SCREEN_SHARE) also carries video and is included so
        // screen-only sessions record correctly. Audio-only recording would
        // require a separate audio-only egress type — deferred.
        const src = event.track?.source;
        if (src !== TrackSource.CAMERA && src !== TrackSource.SCREEN_SHARE) break;
        await maybeStartRecording(sessionId);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[livekit-webhook] handler error:', err, 'event:', event.event);
    return new Response('Handler error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

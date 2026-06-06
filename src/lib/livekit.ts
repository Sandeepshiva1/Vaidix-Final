// ════════════════════════════════════════════════════════════════════════════
// LiveKit Server SDK wrapper
// ════════════════════════════════════════════════════════════════════════════
// Mints access tokens for participants, manages rooms, starts/stops Egress.

import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  RoomServiceClient,
  S3Upload,
  TrackSource,
  WebhookReceiver,
  type ParticipantPermission,
} from 'livekit-server-sdk';
import { env } from './env';

export const roomClient = new RoomServiceClient(
  env.LIVEKIT_URL.replace(/^ws/, 'http'),
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET
);

export const egressClient = new EgressClient(
  env.LIVEKIT_URL.replace(/^ws/, 'http'),
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET
);

export const webhookReceiver = new WebhookReceiver(
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET
);

export type LiveKitRole = 'host' | 'co_host' | 'participant' | 'viewer';

export interface TokenOptions {
  identity: string; // user id
  name: string | null | undefined; // display name (DB users.name can be null)
  roomName: string;
  role: LiveKitRole;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
  // Residents get Mic/Camera but NOT screen share unless host grants it
  canShareScreen?: boolean;
}

export async function mintLiveKitToken(opts: TokenOptions): Promise<string> {
  // Never let an empty/null name into the JWT — LiveKit then exposes
  // `participant.name === ""` and our People panel shows a blank row.
  // Fall back to identity so there's always *something* visible, and the
  // UI still has a way to render initials.
  const displayName = opts.name?.trim() || opts.identity;

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: opts.identity,
    name: displayName,
    ttl: opts.ttlSeconds ?? 3600,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
  });

  const isViewer = opts.role === 'viewer';
  const isAdminish = opts.role === 'host' || opts.role === 'co_host';

  const canPublishSources: TrackSource[] = isViewer
    ? []
    : [TrackSource.MICROPHONE, TrackSource.CAMERA];
  if (!isViewer && (isAdminish || opts.canShareScreen)) {
    canPublishSources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }

  at.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish: !isViewer,
    canSubscribe: true,
    // Chat + presence + reaction signals all ride the LiveKit data channel.
    // Webinar attendees and other "viewer" roles still need to broadcast
    // those (their messages must reach the host and other attendees in
    // realtime, QA #11). The persistence + abuse guard lives at the API
    // layer (see /api/classroom/sessions/[id]/chat/route.ts), not in the
    // LiveKit grant — so opening canPublishData is safe for every role.
    canPublishData: true,
    canPublishSources,
    roomAdmin: isAdminish,
    canUpdateOwnMetadata: true,
  });

  return at.toJwt();
}

// ----------------------------------------------------------------------------
// Room lifecycle
// ----------------------------------------------------------------------------
export async function createRoom(name: string, maxParticipants = 100) {
  return roomClient.createRoom({
    name,
    maxParticipants,
    emptyTimeout: 300,
    departureTimeout: 20,
  });
}

export async function listRooms() {
  return roomClient.listRooms();
}

export async function deleteRoom(name: string) {
  return roomClient.deleteRoom(name);
}

export async function endRoom(name: string) {
  // LiveKit doesn't have a distinct "end" — deleteRoom disconnects everyone.
  return roomClient.deleteRoom(name);
}

// ----------------------------------------------------------------------------
// Participant ops
// ----------------------------------------------------------------------------
export async function listParticipants(roomName: string) {
  return roomClient.listParticipants(roomName);
}

export async function removeParticipant(roomName: string, identity: string) {
  return roomClient.removeParticipant(roomName, identity);
}

export async function muteTrack(
  roomName: string,
  identity: string,
  trackSid: string,
  muted = true
) {
  return roomClient.mutePublishedTrack(roomName, identity, trackSid, muted);
}

export async function updateParticipantMetadata(
  roomName: string,
  identity: string,
  metadata: Record<string, unknown>
) {
  return roomClient.updateParticipant(roomName, identity, JSON.stringify(metadata));
}

export async function updateParticipantPermissions(
  roomName: string,
  identity: string,
  permission: ParticipantPermission
) {
  return roomClient.updateParticipant(roomName, identity, undefined, permission);
}

export async function sendDataMessage(
  roomName: string,
  data: Uint8Array,
  destinationIdentities?: string[]
) {
  return roomClient.sendData(roomName, data, 1 /* reliable */, {
    destinationIdentities,
  });
}

export function sessionRoomName(sessionId: string): string {
  return `session-${sessionId}`;
}

// ----------------------------------------------------------------------------
// Egress (server-side recording → MP4 → MinIO/S3 → HLS via transcode worker)
// ----------------------------------------------------------------------------
// Egress writes to the local volume mounted at /output inside the egress
// container (mapped to <VAIDIX_DATA_ROOT>/recordings/raw on host). The
// transcode worker (src/server/workers/transcode-worker.ts) picks up the
// completed MP4 — triggered by the egress_ended webhook — and produces HLS
// + uploads to MinIO. See egress.yaml and docker-compose.dev.yml for the
// volume mapping. The filename uses {sessionId}-{timestamp}.mp4 so
// concurrent re-records of the same session never collide.

export interface StartSessionEgressResult {
  egressId: string;
  filepath: string;
}

/**
 * Start a Room-Composite recording for the given session. Idempotency is the
 * caller's responsibility — typically the room_started webhook checks the
 * Recording row first to avoid double-triggering on reconnects.
 *
 * VIDEO BY DEFAULT (Teams/Zoom/Meet style) — the egress Chrome bot renders
 * the room layout with all participants visible and captures the composite
 * as one MP4. Layout defaults to `speaker` (active speaker large + others as
 * thumbnails) which matches the lecture/grand-rounds primary use case; pass
 * `layout: 'grid'` for true gallery view.
 *
 * Trade-off: Room Composite waits for a "start signal" (first published
 * track) for ~30s before aborting. With video on, you'll get a "Start signal
 * not received" failure if no one turns on their camera or mic within that
 * window. For pure-audio sessions (no one will share video), pass
 * `audioOnly: true` to drop the camera requirement.
 *
 * Throws if LiveKit rejects the request (e.g. room not found, egress quota
 * exceeded). Callers should catch + audit + degrade gracefully so a recording
 * failure never breaks the live session itself.
 */
export interface StartSessionEgressOptions {
  /** Default false. Set true to skip video and record only the audio mix. */
  audioOnly?: boolean;
  /** Default 'speaker'. Use 'grid' for a Zoom-style gallery view. */
  layout?: 'speaker' | 'grid' | 'single-speaker';
}

export async function startSessionEgress(
  sessionId: string,
  options: StartSessionEgressOptions = {}
): Promise<StartSessionEgressResult> {
  const audioOnly = options.audioOnly ?? false;
  const layout = options.layout ?? 'speaker';
  // Always MP4 — audio-only MP4 has just an AAC track and no video track.
  // Keeping the container constant means the transcode worker stays simple
  // (one input format, ffmpeg auto-detects audio vs audio+video).
  //
  // Direct upload to MinIO/S3 — the transcode worker fetches by S3 key via
  // presignDownload(), so the egress must put the file IN object storage,
  // not on a local disk volume. The S3 destination uses the Docker-internal
  // endpoint (EGRESS_S3_ENDPOINT, typically http://minio:9000) because the
  // egress container reaches MinIO via the Docker bridge network.
  const filepath = `recordings/${sessionId}-${Date.now()}.mp4`;

  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath,
    output: {
      case: 's3',
      value: new S3Upload({
        accessKey: env.S3_ACCESS_KEY,
        secret: env.S3_SECRET_KEY,
        bucket: env.S3_RECORDINGS_BUCKET,
        region: env.S3_REGION,
        endpoint: env.EGRESS_S3_ENDPOINT ?? '',
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      }),
    },
  });

  const info = await egressClient.startRoomCompositeEgress(
    sessionRoomName(sessionId),
    fileOutput,
    {
      layout,
      audioOnly,
      videoOnly: false,
      encodingOptions: audioOnly ? undefined : EncodingOptionsPreset.H264_720P_30,
    }
  );

  if (!info.egressId) {
    throw new Error('Egress started but no egressId returned');
  }
  return { egressId: info.egressId, filepath };
}

/**
 * Stop an in-flight egress. The egress_ended webhook will fire shortly after
 * with EGRESS_COMPLETE (or EGRESS_FAILED on errors), advancing the recording
 * pipeline to TRANSCODING.
 */
export async function stopEgress(egressId: string) {
  return egressClient.stopEgress(egressId);
}

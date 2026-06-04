// ════════════════════════════════════════════════════════════════════════════
// Recording Service — W4 Stream A
// ════════════════════════════════════════════════════════════════════════════
// Access control + signed URL minting for HLS playback.
// HLS master.m3u8 + variant playlists + .ts segments are all in MinIO.
// We mint a single short-lived signed master URL and rely on the player to
// follow relative paths inside the bucket (MinIO supports path-style URLs).

import { db } from '@/lib/db';
import { presignDownload } from '@/lib/storage';
import { Role, RecordingStatus } from '@prisma/client';

// Statuses where the HLS package has been fully written to MinIO and the
// video is playable. Transcription/AI may have failed or be in progress, but
// the video itself is ready. We serve playback for all of these — captions
// will just be absent when transcription hasn't finished.
const HLS_PLAYABLE_STATUSES = new Set<RecordingStatus>([
  RecordingStatus.TRANSCRIBING,
  RecordingStatus.TRANSCRIBING_FAILED,
  RecordingStatus.AI_PROCESSING,
  RecordingStatus.AI_PROCESSING_FAILED,
  RecordingStatus.READY,
]);

export interface RecordingViewModel {
  id: string;
  sessionId: string;
  status: RecordingStatus;
  pipelineStage: RecordingStatus;
  durationSec: number | null;
  hlsUrl: string | null;
  thumbnailUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  transcripts: Array<{ language: string; source: string; vttUrl: string }>;
}

/**
 * Map the DB-level transcript source (vendor name — 'deepgram', 'sarvam', …)
 * to a provider-neutral label before it crosses the wire. Faculty and
 * residents never need to know which ASR vendor produced the transcript;
 * leaking it tells outside observers our infra stack. 'manual' edits stay
 * 'manual' because that is a meaningful workflow distinction for reviewers.
 */
function wireTranscriptSource(dbSource: string): 'asr' | 'manual' {
  return dbSource === 'manual' ? 'manual' : 'asr';
}

export interface RecordingAccessActor {
  userId: string;
  role: Role;
}

export class RecordingAccessError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN', message: string) {
    super(message);
  }
}

export async function userCanViewSession(actor: RecordingAccessActor, sessionId: string): Promise<boolean> {
  // Admin / Program Director / Faculty have broad access to recordings within institution.
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) return true;

  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      hostId: true,
      openToAll: true,
      cohortId: true,
      proposedBy: true,
      participants: { where: { userId: actor.userId }, select: { userId: true } },
      invites: { where: { userId: actor.userId }, select: { userId: true } },
    },
  });
  if (!session) return false;

  // Host / proposer can always view.
  if (session.hostId === actor.userId || session.proposedBy === actor.userId) return true;

  // Participant of the session (joined while it was live) can view.
  if (session.participants.length > 0) return true;

  // Audience axes — any match grants playback access.
  if (session.openToAll) return true;
  if (session.cohortId && actor.role === Role.RESIDENT) {
    const member = await db.cohortMember.findUnique({
      where: { cohortId_userId: { cohortId: session.cohortId, userId: actor.userId } },
      select: { userId: true },
    });
    if (member) return true;
  }
  if (session.invites.length > 0) return true;

  // Faculty default: any approved session in their institution
  if (actor.role === Role.FACULTY) return true;

  return false;
}

export async function listSessionRecordings(
  actor: RecordingAccessActor,
  sessionId: string
): Promise<RecordingViewModel[]> {
  const allowed = await userCanViewSession(actor, sessionId);
  if (!allowed) throw new RecordingAccessError('FORBIDDEN', 'No access to this session');

  const recordings = await db.recording.findMany({
    where: { sessionId, expungedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { transcripts: { select: { language: true, source: true } } },
  });

  const out: RecordingViewModel[] = [];
  for (const r of recordings) {
    // HLS is served through an authenticated Next.js proxy (see
    // /api/recordings/[id]/hls/[...path]). Presigning only the master.m3u8
    // doesn't work for HLS — the player resolves variant playlists and
    // segments relative to the master URL, dropping the signature.
    // Serve the video for any post-transcode status — captions may be absent
    // if transcription hasn't completed, but the video itself is playable.
    const hlsUrl = r.hlsPath && HLS_PLAYABLE_STATUSES.has(r.status)
      ? `/api/recordings/${r.id}/hls/master.m3u8`
      : null;
    const thumbnailUrl = r.thumbnailUrl
      ? await presignDownload(r.thumbnailUrl, 6 * 3600).catch(() => null)
      : null;
    const transcripts: RecordingViewModel['transcripts'] = [];
    for (const t of r.transcripts) {
      const vttKey = `captions/${sessionId}/${t.language}.vtt`;
      const vttUrl = await presignDownload(vttKey, 6 * 3600).catch(() => '');
      transcripts.push({ language: t.language, source: wireTranscriptSource(t.source), vttUrl });
    }
    out.push({
      id: r.id,
      sessionId: r.sessionId,
      status: r.status,
      pipelineStage: r.pipelineStage,
      durationSec: r.durationSec,
      hlsUrl,
      thumbnailUrl,
      failureReason: r.failureReason,
      createdAt: r.createdAt.toISOString(),
      transcripts,
    });
  }
  return out;
}

export async function getRecordingForViewer(
  actor: RecordingAccessActor,
  recordingId: string
): Promise<RecordingViewModel> {
  const recording = await db.recording.findUnique({
    where: { id: recordingId },
    include: { transcripts: { select: { language: true, source: true } } },
  });
  if (!recording || recording.expungedAt) {
    throw new RecordingAccessError('NOT_FOUND', 'Recording not found');
  }
  const allowed = await userCanViewSession(actor, recording.sessionId);
  if (!allowed) throw new RecordingAccessError('FORBIDDEN', 'No access');

  const hlsUrl =
    recording.hlsPath && HLS_PLAYABLE_STATUSES.has(recording.status)
      ? `/api/recordings/${recording.id}/hls/master.m3u8`
      : null;
  const thumbnailUrl = recording.thumbnailUrl
    ? await presignDownload(recording.thumbnailUrl, 6 * 3600).catch(() => null)
    : null;
  const transcripts: RecordingViewModel['transcripts'] = [];
  for (const t of recording.transcripts) {
    const vttKey = `captions/${recording.sessionId}/${t.language}.vtt`;
    const vttUrl = await presignDownload(vttKey, 6 * 3600).catch(() => '');
    transcripts.push({ language: t.language, source: t.source, vttUrl });
  }

  return {
    id: recording.id,
    sessionId: recording.sessionId,
    status: recording.status,
    pipelineStage: recording.pipelineStage,
    durationSec: recording.durationSec,
    hlsUrl,
    thumbnailUrl,
    failureReason: recording.failureReason,
    createdAt: recording.createdAt.toISOString(),
    transcripts,
  };
}

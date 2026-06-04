// ════════════════════════════════════════════════════════════════════════════
// Reels Service — Stream A8
// ════════════════════════════════════════════════════════════════════════════
// Creates a Clip row of kind=REEL, then enqueues a `reel-render` job that
// runs FFmpeg to extract + vertical-crop + re-encode for Instagram Reels.
// 30-second cap (1080×1920, 30fps, AAC stereo).

import { db } from '@/lib/db';
import { Role, ClipKind } from '@prisma/client';
import { getQueue, QUEUES } from '@/lib/queue';

export class ReelAccessError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID', message: string) {
    super(message);
  }
}

export interface CreateReelInput {
  sessionId: string;
  startSec: number;
  endSec: number;
  title?: string;
  createdBy: { userId: string; role: Role };
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];
const MAX_REEL_LENGTH_SEC = 30;
const MIN_REEL_LENGTH_SEC = 5;

export async function createReel(input: CreateReelInput): Promise<{ clipId: string; jobId: string }> {
  if (!FACULTY_LIKE.includes(input.createdBy.role)) {
    throw new ReelAccessError('FORBIDDEN', 'Only faculty/PD/admin can generate reels');
  }
  const length = input.endSec - input.startSec;
  if (length < MIN_REEL_LENGTH_SEC || length > MAX_REEL_LENGTH_SEC) {
    throw new ReelAccessError(
      'INVALID',
      `Reel must be between ${MIN_REEL_LENGTH_SEC} and ${MAX_REEL_LENGTH_SEC} seconds`
    );
  }
  if (input.startSec < 0) {
    throw new ReelAccessError('INVALID', 'startSec cannot be negative');
  }

  const recording = await db.recording.findUnique({
    where: { sessionId: input.sessionId },
    select: { id: true, rawS3Key: true, durationSec: true },
  });
  if (!recording) throw new ReelAccessError('NOT_FOUND', 'No recording for this session');
  if (!recording.rawS3Key) throw new ReelAccessError('INVALID', 'Recording has no source MP4 yet');
  if (recording.durationSec != null && input.endSec > recording.durationSec) {
    throw new ReelAccessError('INVALID', `endSec exceeds recording duration ${recording.durationSec}s`);
  }

  const clip = await db.clip.create({
    data: {
      recordingId: recording.id,
      createdById: input.createdBy.userId,
      kind: ClipKind.REEL,
      title: input.title ?? `Reel ${input.startSec}-${input.endSec}s`,
      startSec: Math.floor(input.startSec),
      endSec: Math.floor(input.endSec),
    },
    select: { id: true },
  });

  const jobId = `reel-render-${clip.id}`;
  await getQueue(QUEUES.RECORDING).add(
    'reel-render',
    { clipId: clip.id },
    { jobId }
  );
  return { clipId: clip.id, jobId };
}

export async function listReels(sessionId: string, actor: { userId: string; role: Role }): Promise<Array<{
  id: string;
  title: string | null;
  startSec: number;
  endSec: number;
  status: 'PENDING' | 'READY' | 'FAILED';
  s3Key: string | null;
  createdAt: string;
}>> {
  const recording = await db.recording.findUnique({
    where: { sessionId },
    select: { id: true },
  });
  if (!recording) return [];
  const clips = await db.clip.findMany({
    where: { recordingId: recording.id, kind: ClipKind.REEL },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, startSec: true, endSec: true, s3Key: true, createdAt: true, createdById: true },
  });
  // All faculty-like + clip creator can see; residents can see only after host has approved tagging — kept simple here.
  const isFaculty = FACULTY_LIKE.includes(actor.role);
  return clips
    .filter((c) => isFaculty || c.createdById === actor.userId)
    .map((c) => ({
      id: c.id,
      title: c.title,
      startSec: c.startSec,
      endSec: c.endSec,
      status: c.s3Key ? 'READY' : 'PENDING',
      s3Key: c.s3Key,
      createdAt: c.createdAt.toISOString(),
    }));
}

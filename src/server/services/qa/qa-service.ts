// ════════════════════════════════════════════════════════════════════════════
// Q&A Service
// ════════════════════════════════════════════════════════════════════════════
// Timestamped Q&A on session recordings with single-level reply threads.
//
// Schema invariants (enforced here, app-level):
//   - A reply (parentId != null) cannot itself have replies
//   - A reply must belong to the same recording as its parent
//   - A reply's timestampSec is inherited from the parent's at create time
//
// V1 of UI is a sidebar list; timeline markers ship in V2 post-showcase.

import { db } from '@/lib/db';
import { Role } from '@prisma/client';

export class QaError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID' | 'FORBIDDEN' | 'RECORDING_NOT_READY',
    message: string
  ) {
    super(message);
  }
}

export interface QaActor {
  userId: string;
  role: Role;
}

export interface QaItemView {
  id: string;
  recordingId: string;
  userId: string;
  userName: string;
  timestampSec: number;
  question: string;
  pinned: boolean;
  likeCount: number;
  parentId: string | null;
  createdAt: string;
  replies: QaItemView[];
  likedByMe: boolean;
  // Faculty answer surface (set via answerQuestion). Distinct from replies —
  // an "official" answer is what learners see prominently, while replies are
  // free-form discussion. Both can co-exist.
  answer: string | null;
  answeredById: string | null;
  answeredByName: string | null;
  answeredAt: string | null;
}

async function resolveRecordingFromSession(sessionId: string): Promise<{ recordingId: string }> {
  const recording = await db.recording.findUnique({
    where: { sessionId },
    select: { id: true, expungedAt: true },
  });
  if (!recording) throw new QaError('RECORDING_NOT_READY', 'No recording for this session yet');
  if (recording.expungedAt) throw new QaError('NOT_FOUND', 'Recording has been expunged');
  return { recordingId: recording.id };
}

export async function postQuestion(
  actor: QaActor,
  sessionId: string,
  input: { timestampSec: number; question: string }
): Promise<{ id: string }> {
  const { recordingId } = await resolveRecordingFromSession(sessionId);
  const created = await db.qaItem.create({
    data: {
      recordingId,
      userId: actor.userId,
      timestampSec: Math.max(0, Math.floor(input.timestampSec)),
      question: input.question.trim(),
    },
    select: { id: true },
  });
  return created;
}

export async function postReply(
  actor: QaActor,
  sessionId: string,
  parentQaId: string,
  input: { question: string }
): Promise<{ id: string }> {
  const { recordingId } = await resolveRecordingFromSession(sessionId);
  const parent = await db.qaItem.findUnique({
    where: { id: parentQaId },
    select: { id: true, parentId: true, recordingId: true, timestampSec: true },
  });
  if (!parent) throw new QaError('NOT_FOUND', 'Parent comment missing');
  if (parent.parentId !== null) throw new QaError('INVALID', 'Replies cannot have replies');
  if (parent.recordingId !== recordingId) {
    throw new QaError('INVALID', 'Parent belongs to a different recording');
  }
  const created = await db.qaItem.create({
    data: {
      recordingId,
      userId: actor.userId,
      parentId: parent.id,
      timestampSec: parent.timestampSec,
      question: input.question.trim(),
    },
    select: { id: true },
  });
  return created;
}

export async function listQa(actor: QaActor, sessionId: string): Promise<QaItemView[]> {
  const recording = await db.recording.findUnique({
    where: { sessionId },
    select: { id: true, expungedAt: true },
  });
  if (!recording || recording.expungedAt) return [];

  const rows = await db.qaItem.findMany({
    where: { recordingId: recording.id },
    orderBy: [{ pinned: 'desc' }, { timestampSec: 'asc' }, { createdAt: 'asc' }],
    include: {
      user: { select: { id: true, name: true } },
      reactions: { where: { userId: actor.userId }, select: { id: true } },
    },
  });

  // Resolve answeredBy names in one extra round-trip (small set — rarely
  // more than ~50 unique answerers per recording).
  const answeredByIds = Array.from(new Set(rows.map((r) => r.answeredById).filter((x): x is string => !!x)));
  const answeredByMap = new Map<string, string>();
  if (answeredByIds.length > 0) {
    const answerers = await db.user.findMany({
      where: { id: { in: answeredByIds } },
      select: { id: true, name: true },
    });
    for (const a of answerers) answeredByMap.set(a.id, a.name);
  }

  // Group: top-level by id, replies under their parent.
  const top: QaItemView[] = [];
  const byParent = new Map<string, QaItemView[]>();

  for (const r of rows) {
    const view: QaItemView = {
      id: r.id,
      recordingId: r.recordingId,
      userId: r.userId,
      userName: r.user.name,
      timestampSec: r.timestampSec,
      question: r.question,
      pinned: r.pinned,
      likeCount: r.likeCount,
      parentId: r.parentId,
      createdAt: r.createdAt.toISOString(),
      replies: [],
      likedByMe: r.reactions.length > 0,
      answer: r.answer ?? null,
      answeredById: r.answeredById ?? null,
      answeredByName: r.answeredById ? answeredByMap.get(r.answeredById) ?? null : null,
      answeredAt: r.answeredAt?.toISOString() ?? null,
    };
    if (r.parentId) {
      const arr = byParent.get(r.parentId) ?? [];
      arr.push(view);
      byParent.set(r.parentId, arr);
    } else {
      top.push(view);
    }
  }
  for (const t of top) {
    t.replies = byParent.get(t.id) ?? [];
  }
  return top;
}

export async function setLike(
  actor: QaActor,
  qaItemId: string,
  liked: boolean
): Promise<{ likeCount: number }> {
  const item = await db.qaItem.findUnique({
    where: { id: qaItemId },
    select: { id: true },
  });
  if (!item) throw new QaError('NOT_FOUND', 'Q&A item not found');

  // Atomic: upsert/delete reaction + recompute likeCount in a transaction.
  return await db.$transaction(async (tx) => {
    if (liked) {
      await tx.qaReaction.upsert({
        where: { qaItemId_userId_kind: { qaItemId, userId: actor.userId, kind: 'LIKE' } },
        create: { qaItemId, userId: actor.userId, kind: 'LIKE' },
        update: {},
      });
    } else {
      await tx.qaReaction.deleteMany({
        where: { qaItemId, userId: actor.userId, kind: 'LIKE' },
      });
    }
    const count = await tx.qaReaction.count({ where: { qaItemId, kind: 'LIKE' } });
    await tx.qaItem.update({ where: { id: qaItemId }, data: { likeCount: count } });
    return { likeCount: count };
  });
}

async function userIsHostOrPrivileged(
  actor: QaActor,
  sessionId: string
): Promise<boolean> {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) return true;
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  return !!session && session.hostId === actor.userId;
}

export async function setPinned(
  actor: QaActor,
  sessionId: string,
  qaItemId: string,
  pinned: boolean
): Promise<void> {
  const allowed = await userIsHostOrPrivileged(actor, sessionId);
  if (!allowed) throw new QaError('FORBIDDEN', 'Only host, PD, or admin can pin');

  const item = await db.qaItem.findUnique({
    where: { id: qaItemId },
    select: { id: true, parentId: true, recording: { select: { sessionId: true } } },
  });
  if (!item) throw new QaError('NOT_FOUND', 'Q&A item not found');
  if (item.recording.sessionId !== sessionId) {
    throw new QaError('INVALID', 'Q&A item does not belong to this session');
  }
  if (item.parentId !== null) throw new QaError('INVALID', 'Cannot pin a reply');

  await db.qaItem.update({ where: { id: qaItemId }, data: { pinned } });
}

/**
 * Mark a question as officially answered. Only FACULTY/PD/ADMIN or the
 * session host can answer. Replies remain a parallel free-form thread; an
 * answer is a curated, prominent response surfaced to all learners.
 *
 * Pass `answer = null` to clear an existing answer (un-mark as answered).
 */
export async function answerQuestion(
  actor: QaActor,
  sessionId: string,
  qaItemId: string,
  answer: string | null
): Promise<{ answered: boolean }> {
  if (
    actor.role !== Role.FACULTY &&
    actor.role !== Role.PROGRAM_DIRECTOR &&
    actor.role !== Role.ADMIN
  ) {
    // Host can also answer even if their role is something else, but in
    // practice hosts are FACULTY/PD; check defensively.
    const isHost = await userIsHostOrPrivileged(actor, sessionId);
    if (!isHost) throw new QaError('FORBIDDEN', 'Only faculty, PD, admin, or host can answer');
  }

  const item = await db.qaItem.findUnique({
    where: { id: qaItemId },
    select: { id: true, parentId: true, recording: { select: { sessionId: true } } },
  });
  if (!item) throw new QaError('NOT_FOUND', 'Q&A item not found');
  if (item.recording.sessionId !== sessionId) {
    throw new QaError('INVALID', 'Q&A item does not belong to this session');
  }
  if (item.parentId !== null) {
    throw new QaError('INVALID', 'Cannot mark a reply as the answer; answer the parent question instead');
  }

  const trimmed = answer?.trim() ?? '';
  if (trimmed.length === 0) {
    await db.qaItem.update({
      where: { id: qaItemId },
      data: { answer: null, answeredById: null, answeredAt: null },
    });
    return { answered: false };
  }

  await db.qaItem.update({
    where: { id: qaItemId },
    data: {
      answer: trimmed,
      answeredById: actor.userId,
      answeredAt: new Date(),
    },
  });
  return { answered: true };
}

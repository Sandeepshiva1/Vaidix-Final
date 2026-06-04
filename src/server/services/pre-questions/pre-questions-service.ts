// ════════════════════════════════════════════════════════════════════════════
// Pre-Conference Question Engine — W6 (Feeddback #2)
// ════════════════════════════════════════════════════════════════════════════
// Residents submit questions ahead of a session and upvote others. A debounced
// BullMQ job re-clusters into themes ~30s after the last submission/vote so
// the presenter dashboard stays fresh without thrashing the LLM.
//
// Authorization summary:
//   - Submit / vote: any authenticated user with visibility into the session
//     (visibility check delegated to recordings/session helpers below).
//   - Theme list / dashboard: same visibility rules — residents see anonymized
//     themes; presenters see the full Top-N with question counts.
//   - Force re-cluster: host / PD / admin only.

import { db } from '@/lib/db';
import {
  PreSessionQuestionUrgency,
  Role,
  UserStatus,
  type Prisma,
} from '@prisma/client';
import { getQueue, QUEUES } from '@/lib/queue';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { emit } from '@/server/services/notifications-service';
import {
  clusterPreQuestions,
  type ClusterInputQuestion,
} from './cluster-questions';
import {
  userCanSeeSession as sharedUserCanSeeSession,
  userIsHostOrPrivileged as sharedUserIsHostOrPrivileged,
} from '@/server/services/sessions/visibility';

export class PreQuestionError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID'
      | 'FORBIDDEN'
      | 'SESSION_NOT_VISIBLE'
      | 'CLUSTER_FAILED',
    message: string
  ) {
    super(message);
  }
}

export interface PreQuestionActor {
  userId: string;
  role: Role;
}

export interface PreQuestionView {
  id: string;
  sessionId: string;
  userId: string;
  authorName: string;
  content: string;
  urgency: PreSessionQuestionUrgency;
  voteCount: number;
  votedByMe: boolean;
  themeId: string | null;
  themeLabel: string | null;
  parentId: string | null;
  isPresenter: boolean; // True when the author hosts this session — replies get a distinct visual treatment.
  createdAt: string;
  replies: PreQuestionReplyView[];
}

export interface PreQuestionReplyView {
  id: string;
  userId: string;
  authorName: string;
  content: string;
  isPresenter: boolean;
  createdAt: string;
}

export interface ThemeView {
  id: string;
  label: string;
  summary: string;
  questionCount: number;
  rank: number;
  generatedAt: string;
}

const RECLUSTER_DEBOUNCE_MS = 30_000;

// ─── Visibility ──────────────────────────────────────────────────────────────
// Delegate to the shared helpers in sessions/visibility.ts so pre-questions,
// study-pack, readiness, and the classroom list always agree on who can see
// a session. Previously this file carried a duplicated implementation that
// drifted across refactors.
async function userCanSeeSession(actor: PreQuestionActor, sessionId: string): Promise<boolean> {
  return sharedUserCanSeeSession(actor, sessionId);
}

async function userIsHostOrPrivileged(
  actor: PreQuestionActor,
  sessionId: string
): Promise<boolean> {
  return sharedUserIsHostOrPrivileged(actor, sessionId);
}

// ─── Submit / list / vote ────────────────────────────────────────────────────
export async function submitQuestion(
  actor: PreQuestionActor,
  sessionId: string,
  input: { content: string; urgency?: PreSessionQuestionUrgency }
): Promise<{ id: string }> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new PreQuestionError('SESSION_NOT_VISIBLE', 'No visibility into this session');
  }
  const content = input.content.trim();
  if (content.length < 5 || content.length > 500) {
    throw new PreQuestionError('INVALID', 'Question must be 5–500 characters');
  }
  const created = await db.preSessionQuestion.create({
    data: {
      sessionId,
      userId: actor.userId,
      content,
      urgency: input.urgency ?? PreSessionQuestionUrgency.NORMAL,
    },
    select: { id: true },
  });
  await scheduleRecluster(sessionId);

  // Notify the session host (faculty) that a new pre-conference question was
  // posted. Skip if the submitter IS the host (they know what they wrote).
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, title: true, host: { select: { status: true } } },
  });
  if (session && session.hostId !== actor.userId && session.host.status === UserStatus.ACTIVE) {
    await emit({
      userId: session.hostId,
      kind: 'prequestion.posted',
      title: `New pre-class question for "${session.title}"`,
      body: content.length > 100 ? `${content.slice(0, 97)}…` : content,
      payload: { sessionId, questionId: created.id, urgency: input.urgency ?? 'NORMAL' },
    });
  }

  return created;
}

export async function listQuestions(
  actor: PreQuestionActor,
  sessionId: string
): Promise<PreQuestionView[]> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new PreQuestionError('SESSION_NOT_VISIBLE', 'No visibility into this session');
  }

  // One round-trip for both top-level questions and their replies. We sort
  // in JS afterwards so we keep the conventional "top-level by votes, replies
  // by chronology" ordering without two separate queries.
  const [rows, session] = await Promise.all([
    db.preSessionQuestion.findMany({
      where: { sessionId },
      include: {
        user: { select: { id: true, name: true } },
        theme: { select: { id: true, label: true } },
        votes: { where: { userId: actor.userId }, select: { id: true } },
      },
    }),
    db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { hostId: true },
    }),
  ]);
  const hostId = session?.hostId ?? null;

  // Partition into top-level + replies (keyed by parentId).
  const replyMap = new Map<string, PreQuestionReplyView[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const view: PreQuestionReplyView = {
      id: r.id,
      userId: r.userId,
      authorName: r.user.name,
      content: r.content,
      isPresenter: hostId === r.userId,
      createdAt: r.createdAt.toISOString(),
    };
    const arr = replyMap.get(r.parentId) ?? [];
    arr.push(view);
    replyMap.set(r.parentId, arr);
  }
  // Replies chronological under each parent.
  for (const arr of replyMap.values()) {
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const topLevel = rows
    .filter((r) => r.parentId === null)
    .sort((a, b) => {
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  return topLevel.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    userId: r.userId,
    authorName: r.user.name,
    content: r.content,
    urgency: r.urgency,
    voteCount: r.voteCount,
    votedByMe: r.votes.length > 0,
    themeId: r.themeId,
    themeLabel: r.theme?.label ?? null,
    parentId: null,
    isPresenter: hostId === r.userId,
    createdAt: r.createdAt.toISOString(),
    replies: replyMap.get(r.id) ?? [],
  }));
}

export async function setVote(
  actor: PreQuestionActor,
  sessionId: string,
  questionId: string,
  voted: boolean
): Promise<{ voteCount: number }> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new PreQuestionError('SESSION_NOT_VISIBLE', 'No visibility into this session');
  }
  const q = await db.preSessionQuestion.findUnique({
    where: { id: questionId },
    select: { id: true, sessionId: true, userId: true, parentId: true },
  });
  if (!q) throw new PreQuestionError('NOT_FOUND', 'Question not found');
  if (q.sessionId !== sessionId) {
    throw new PreQuestionError('INVALID', 'Question does not belong to this session');
  }
  if (q.parentId !== null) {
    // Replies are conversation, not ranked content — voting is for top-level only.
    throw new PreQuestionError('INVALID', 'Replies cannot be voted on');
  }
  if (q.userId === actor.userId) {
    // Authors can't upvote their own question. Soft 400 instead of silent.
    throw new PreQuestionError('INVALID', 'Authors cannot vote on their own question');
  }

  return await db.$transaction(async (tx) => {
    if (voted) {
      await tx.preSessionQuestionVote.upsert({
        where: { questionId_userId: { questionId, userId: actor.userId } },
        create: { questionId, userId: actor.userId },
        update: {},
      });
    } else {
      await tx.preSessionQuestionVote.deleteMany({
        where: { questionId, userId: actor.userId },
      });
    }
    const count = await tx.preSessionQuestionVote.count({ where: { questionId } });
    await tx.preSessionQuestion.update({
      where: { id: questionId },
      data: { voteCount: count },
    });
    return { voteCount: count };
  });
}

// ─── Replies ────────────────────────────────────────────────────────────────
// Single-level threads (mirrors the QaItem pattern): a reply (parentId != null)
// cannot itself have replies. Service-level guard rejects nested replies; the
// FK cascade keeps orphans cleaned up on parent delete.

export async function postReply(
  actor: PreQuestionActor,
  sessionId: string,
  parentId: string,
  input: { content: string }
): Promise<{ id: string }> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new PreQuestionError('SESSION_NOT_VISIBLE', 'No visibility into this session');
  }
  const content = input.content.trim();
  if (content.length < 2 || content.length > 2000) {
    throw new PreQuestionError('INVALID', 'Reply must be 2–2000 characters');
  }

  const parent = await db.preSessionQuestion.findUnique({
    where: { id: parentId },
    select: { id: true, sessionId: true, userId: true, parentId: true, content: true },
  });
  if (!parent) throw new PreQuestionError('NOT_FOUND', 'Parent question not found');
  if (parent.sessionId !== sessionId) {
    throw new PreQuestionError('INVALID', 'Parent belongs to a different session');
  }
  if (parent.parentId !== null) {
    throw new PreQuestionError('INVALID', 'Replies cannot have replies');
  }

  const created = await db.preSessionQuestion.create({
    data: {
      sessionId,
      userId: actor.userId,
      content,
      urgency: PreSessionQuestionUrgency.NORMAL,
      parentId: parent.id,
    },
    select: { id: true },
  });

  // Notify the parent author so they know their question got a response. Skip
  // self-replies (the author already knows they typed it). Mirrors the host
  // notification on submitQuestion so the same emit() surface handles both.
  if (parent.userId !== actor.userId) {
    const author = await db.user.findUnique({
      where: { id: parent.userId },
      select: { status: true },
    });
    if (author?.status === UserStatus.ACTIVE) {
      await emit({
        userId: parent.userId,
        kind: 'prequestion.replied',
        title: 'New reply to your pre-class question',
        body: content.length > 100 ? `${content.slice(0, 97)}…` : content,
        payload: { sessionId, parentId: parent.id, replyId: created.id },
      });
    }
  }

  return created;
}

// ─── Themes / presenter dashboard ────────────────────────────────────────────
export async function listThemes(
  actor: PreQuestionActor,
  sessionId: string
): Promise<ThemeView[]> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new PreQuestionError('SESSION_NOT_VISIBLE', 'No visibility into this session');
  }
  const rows = await db.preSessionQuestionTheme.findMany({
    where: { sessionId },
    orderBy: [{ rank: 'asc' }, { questionCount: 'desc' }],
  });
  return rows.map((t) => ({
    id: t.id,
    label: t.label,
    summary: t.summary,
    questionCount: t.questionCount,
    rank: t.rank,
    generatedAt: t.generatedAt.toISOString(),
  }));
}

export interface DashboardResult {
  totalQuestions: number;
  themesGeneratedAt: string | null;
  topThemes: Array<ThemeView & { exampleQuestions: string[] }>;
  unthemedCount: number;
}

export async function getDashboard(
  actor: PreQuestionActor,
  sessionId: string,
  topN = 10
): Promise<DashboardResult> {
  if (!(await userIsHostOrPrivileged(actor, sessionId))) {
    throw new PreQuestionError('FORBIDDEN', 'Only host, PD, or admin can view the dashboard');
  }
  const [total, unthemed, themes] = await Promise.all([
    db.preSessionQuestion.count({ where: { sessionId } }),
    db.preSessionQuestion.count({ where: { sessionId, themeId: null } }),
    db.preSessionQuestionTheme.findMany({
      where: { sessionId },
      orderBy: [{ rank: 'asc' }, { questionCount: 'desc' }],
      take: topN,
      include: {
        questions: {
          orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }],
          take: 3,
          select: { content: true },
        },
      },
    }),
  ]);
  const lastGen = themes[0]?.generatedAt?.toISOString() ?? null;
  return {
    totalQuestions: total,
    themesGeneratedAt: lastGen,
    unthemedCount: unthemed,
    topThemes: themes.map((t) => ({
      id: t.id,
      label: t.label,
      summary: t.summary,
      questionCount: t.questionCount,
      rank: t.rank,
      generatedAt: t.generatedAt.toISOString(),
      exampleQuestions: t.questions.map((q) => q.content),
    })),
  };
}

// ─── Clustering scheduling + execution ───────────────────────────────────────

export interface PreQuestionClusterJobData {
  sessionId: string;
  /** Set when the host clicked "Re-cluster now"; bypasses the debounce delay. */
  immediate?: boolean;
}

/**
 * Enqueue a recluster job for a session. Multiple submissions within the
 * debounce window collapse to a single run because we use the sessionId as
 * the BullMQ jobId — the queue rejects duplicates by id while the job is
 * still delayed/active.
 */
export async function scheduleRecluster(
  sessionId: string,
  opts: { immediate?: boolean } = {}
): Promise<void> {
  const queue = getQueue(QUEUES.PRE_QUESTION_CLUSTER);
  // BullMQ has no native "replace existing delayed job" — we remove first,
  // then re-add. Cheap because the job set per session is small.
  try {
    const existing = await queue.getJob(sessionId);
    if (existing && (await existing.isDelayed())) {
      await existing.remove();
    }
  } catch {
    /* swallow — best-effort */
  }
  await queue.add(
    'cluster',
    { sessionId, immediate: !!opts.immediate } satisfies PreQuestionClusterJobData,
    {
      jobId: sessionId,
      delay: opts.immediate ? 0 : RECLUSTER_DEBOUNCE_MS,
    }
  );
}

export async function forceRecluster(
  actor: PreQuestionActor,
  sessionId: string
): Promise<void> {
  if (!(await userIsHostOrPrivileged(actor, sessionId))) {
    throw new PreQuestionError('FORBIDDEN', 'Only host, PD, or admin can re-cluster');
  }
  await scheduleRecluster(sessionId, { immediate: true });
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    eventType: AUDIT_EVENTS.PRE_QUESTION_RECLUSTER_REQUESTED,
    entityType: 'TeachingSession',
    entityId: sessionId,
  });
}

/**
 * Worker entrypoint: run clustering for a session and persist the result.
 * Called by src/server/workers/pre-question-cluster-worker.ts. Idempotent —
 * safe to re-run; old themes are deleted in the same transaction.
 */
export async function runClusterJob(sessionId: string): Promise<{ themeCount: number; assigned: number; unthemed: number }> {
  // Only top-level questions get clustered — replies are conversation, not
  // themable content. Filtering at the DB keeps the LLM payload tight.
  const questions = await db.preSessionQuestion.findMany({
    where: { sessionId, parentId: null },
    select: { id: true, content: true, voteCount: true },
  });
  if (questions.length === 0) {
    // Nothing to cluster — drop any stale themes.
    await db.preSessionQuestionTheme.deleteMany({ where: { sessionId } });
    return { themeCount: 0, assigned: 0, unthemed: 0 };
  }

  const input: ClusterInputQuestion[] = questions.map((q) => ({
    id: q.id,
    content: q.content,
    voteCount: q.voteCount,
  }));

  let result;
  try {
    result = await clusterPreQuestions(input);
  } catch (err) {
    await audit({
      eventType: AUDIT_EVENTS.PRE_QUESTION_CLUSTER_FAILED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      success: false,
      details: { error: (err as Error).message.slice(0, 500) },
    });
    throw new PreQuestionError('CLUSTER_FAILED', (err as Error).message);
  }

  const { themeCount, assigned, unthemed } = await db.$transaction(
    async (tx) => {
      // Detach existing themes from questions, drop them, recreate.
      await tx.preSessionQuestion.updateMany({
        where: { sessionId },
        data: { themeId: null },
      });
      await tx.preSessionQuestionTheme.deleteMany({ where: { sessionId } });

      // Persist new themes (themeIndex → real id mapping for assignments).
      const indexToId: Record<number, string> = {};
      for (let i = 0; i < result.themes.length; i++) {
        const t = result.themes[i];
        const created = await tx.preSessionQuestionTheme.create({
          data: {
            sessionId,
            label: t.label,
            summary: t.summary,
            rank: i,
            questionCount: 0, // updated below
          },
          select: { id: true },
        });
        indexToId[t.themeIndex] = created.id;
      }

      // Apply per-question assignments.
      let assignedCount = 0;
      for (const a of result.assignments) {
        if (a.themeIndex == null) continue;
        const themeId = indexToId[a.themeIndex];
        if (!themeId) continue;
        await tx.preSessionQuestion.update({
          where: { id: a.questionId },
          data: { themeId },
        });
        assignedCount++;
      }

      // Roll up question counts into themes for the presenter dashboard.
      for (const themeId of Object.values(indexToId)) {
        const c = await tx.preSessionQuestion.count({ where: { themeId } });
        await tx.preSessionQuestionTheme.update({
          where: { id: themeId },
          data: { questionCount: c },
        });
      }

      const unthemedCount = await tx.preSessionQuestion.count({
        where: { sessionId, themeId: null },
      });

      return {
        themeCount: result.themes.length,
        assigned: assignedCount,
        unthemed: unthemedCount,
      };
    },
    { timeout: 30_000 }
  );

  await audit({
    eventType: AUDIT_EVENTS.PRE_QUESTION_THEMES_GENERATED,
    entityType: 'TeachingSession',
    entityId: sessionId,
    details: { themeCount, assigned, unthemed, total: questions.length },
  });
  return { themeCount, assigned, unthemed };
}

// Type re-export so the worker's import surface is clean.
export type { Prisma };

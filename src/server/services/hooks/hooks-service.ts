// ════════════════════════════════════════════════════════════════════════════
// Live Hooks Service
// ════════════════════════════════════════════════════════════════════════════
// Faculty creates hooks ahead of time (or queues recurring ones every 6–8 min).
// At runtime, the LiveSession client polls /hooks?live=1 to discover newly
// fired hooks. Responses go to /hooks/[hookId]/respond and emit a HOOK_RESPONSE
// engagement signal automatically.

import { db } from '@/lib/db';
import { LiveHookKind, Role, EngagementSignalKind } from '@prisma/client';
import { recordEngagementSignal } from '@/server/services/engagement/engagement-service';

export interface CreateHookInput {
  sessionId: string;
  createdById: string;
  kind: LiveHookKind;
  prompt: string;
  options?: string[];
  correctOption?: string;
  explanation?: string;
  intervalSeconds?: number;
  scheduledAt?: Date;
}

export async function createHook(input: CreateHookInput): Promise<{ id: string }> {
  const hook = await db.liveHook.create({
    data: {
      sessionId: input.sessionId,
      createdById: input.createdById,
      kind: input.kind,
      prompt: input.prompt,
      options: input.options ? (input.options as unknown as object) : undefined,
      correctOption: input.correctOption,
      explanation: input.explanation,
      intervalSeconds: input.intervalSeconds,
      scheduledAt: input.scheduledAt ?? new Date(),
    },
    select: { id: true },
  });
  return hook;
}

export async function fireHook(hookId: string, presenterId: string): Promise<void> {
  // Only the host can fire a hook.
  const hook = await db.liveHook.findUnique({
    where: { id: hookId },
    select: { id: true, sessionId: true, firedAt: true, session: { select: { hostId: true } } },
  });
  if (!hook) throw new Error('Hook not found');
  if (hook.session.hostId !== presenterId) throw new Error('Only host can fire hook');
  if (hook.firedAt) return; // idempotent
  await db.liveHook.update({
    where: { id: hookId },
    data: { firedAt: new Date() },
  });
}

/**
 * Mark a hook as pre-published so residents can vote BEFORE the live
 * session starts. Idempotent: calling on an already-published hook just
 * returns the existing timestamp. Refuses to publish polls that have no
 * options (would render an unanswerable card).
 */
export async function prePublishHook(
  hookId: string,
  actor: { userId: string; role: Role }
): Promise<{ prePublishedAt: string }> {
  const hook = await db.liveHook.findUnique({
    where: { id: hookId },
    select: {
      id: true,
      kind: true,
      options: true,
      prePublishedAt: true,
      session: { select: { hostId: true } },
    },
  });
  if (!hook) throw new Error('Hook not found');
  await assertCanManageHook(actor, hook.session.hostId);

  // A POLL with no options can't be voted on. Refuse rather than publish a
  // broken card. Free-form kinds (ONE_WORD, REPEAT_CONCEPT) are fine
  // without options.
  if (hook.kind === LiveHookKind.POLL || hook.kind === LiveHookKind.TRUE_FALSE) {
    const opts = Array.isArray(hook.options) ? (hook.options as unknown[]) : [];
    if (opts.length < 2) throw new Error('Hook must have at least 2 options before publishing');
  }

  if (hook.prePublishedAt) {
    return { prePublishedAt: hook.prePublishedAt.toISOString() };
  }
  const updated = await db.liveHook.update({
    where: { id: hookId },
    data: { prePublishedAt: new Date() },
    select: { prePublishedAt: true },
  });
  return { prePublishedAt: updated.prePublishedAt!.toISOString() };
}

/**
 * Revoke pre-publish. Residents can no longer see the hook (it goes
 * back to a draft state). Existing responses are kept so a presenter who
 * accidentally unpublishes does not lose data. Idempotent.
 */
export async function unPrePublishHook(
  hookId: string,
  actor: { userId: string; role: Role }
): Promise<void> {
  const hook = await db.liveHook.findUnique({
    where: { id: hookId },
    select: { id: true, prePublishedAt: true, session: { select: { hostId: true } } },
  });
  if (!hook) throw new Error('Hook not found');
  await assertCanManageHook(actor, hook.session.hostId);
  if (!hook.prePublishedAt) return; // idempotent
  await db.liveHook.update({
    where: { id: hookId },
    data: { prePublishedAt: null },
  });
}

/**
 * Update a hook's question / options / kind. Only allowed BEFORE the
 * hook has any responses; once residents (or live participants) have voted,
 * the shape is locked to keep the aggregate honest. The presenter must
 * delete and recreate to fundamentally change a hook with votes.
 */
export async function updateHookDraft(
  hookId: string,
  patch: { prompt?: string; options?: string[]; correctOption?: string | null; explanation?: string | null; kind?: LiveHookKind },
  actor: { userId: string; role: Role }
): Promise<void> {
  const hook = await db.liveHook.findUnique({
    where: { id: hookId },
    select: {
      id: true,
      session: { select: { hostId: true } },
      _count: { select: { responses: true } },
    },
  });
  if (!hook) throw new Error('Hook not found');
  await assertCanManageHook(actor, hook.session.hostId);
  if (hook._count.responses > 0) {
    throw new Error('Cannot edit a hook with responses — delete and recreate instead');
  }
  await db.liveHook.update({
    where: { id: hookId },
    data: {
      prompt: patch.prompt,
      options: patch.options ? (patch.options as unknown as object) : undefined,
      correctOption: patch.correctOption === null ? null : patch.correctOption,
      explanation: patch.explanation === null ? null : patch.explanation,
      kind: patch.kind,
    },
  });
}

/**
 * Delete a hook. Refused if there are responses (use unPrePublish
 * instead to take it off the resident page while keeping the data). The
 * narrow allowance preserves audit history when a real poll runs.
 */
export async function deleteHookDraft(
  hookId: string,
  actor: { userId: string; role: Role }
): Promise<void> {
  const hook = await db.liveHook.findUnique({
    where: { id: hookId },
    select: {
      id: true,
      session: { select: { hostId: true } },
      _count: { select: { responses: true } },
    },
  });
  if (!hook) throw new Error('Hook not found');
  await assertCanManageHook(actor, hook.session.hostId);
  if (hook._count.responses > 0) {
    throw new Error('Cannot delete a hook with responses — unpublish to hide instead');
  }
  await db.liveHook.delete({ where: { id: hookId } });
}

/**
 * Aggregate vote counts per option for a hook. Returns the user's
 * own answer too so the resident voter UI can highlight it. The total +
 * per-option counts are safe to expose pre-vote (Mentimeter pattern: hide
 * results until the user has answered), but route-layer enforces that.
 */
export async function getHookResults(
  hookId: string,
  actor: { userId: string; role: Role }
): Promise<{
  total: number;
  counts: Record<string, number>;
  myAnswer: string | null;
  closedAt: string | null;
}> {
  const hook = await db.liveHook.findUnique({
    where: { id: hookId },
    select: { id: true, sessionId: true, closedAt: true, session: { select: { hostId: true } } },
  });
  if (!hook) throw new Error('Hook not found');
  // Anyone authenticated can see results — the route decides if it should
  // gate on "user has voted" for residents. Host/PD/admin always allowed.

  const responses = await db.liveHookResponse.findMany({
    where: { hookId },
    select: { userId: true, response: true },
  });
  const counts: Record<string, number> = {};
  let myAnswer: string | null = null;
  for (const r of responses) {
    counts[r.response] = (counts[r.response] ?? 0) + 1;
    if (r.userId === actor.userId) myAnswer = r.response;
  }
  return {
    total: responses.length,
    counts,
    myAnswer,
    closedAt: hook.closedAt?.toISOString() ?? null,
  };
}

async function assertCanManageHook(
  actor: { userId: string; role: Role },
  hostId: string
): Promise<void> {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) return;
  if (actor.userId === hostId) return;
  throw new Error('Only host/PD/admin can manage this hook');
}

export interface ListedHook {
  id: string;
  kind: LiveHookKind;
  prompt: string;
  options: string[] | null;
  correctOption: string | null;
  explanation: string | null;
  intervalSeconds: number | null;
  scheduledAt: string | null;
  firedAt: string | null;
  closedAt: string | null;
  prePublishedAt: string | null;
  responseCount: number;
  createdAt: string;
}

export async function listLiveHooks(
  sessionId: string,
  opts: { sinceMs?: number; onlyFired?: boolean; prePublished?: boolean } = {}
): Promise<ListedHook[]> {
  const since = opts.sinceMs ? new Date(opts.sinceMs) : undefined;
  const rows = await db.liveHook.findMany({
    where: {
      sessionId,
      ...(opts.onlyFired ? { firedAt: { not: null } } : {}),
      // filter to pre-published-only (resident query); false means
      // "only drafts/unpublished" which the host UI uses to find drafts.
      ...(opts.prePublished === true ? { prePublishedAt: { not: null } } : {}),
      ...(opts.prePublished === false ? { prePublishedAt: null } : {}),
      ...(since ? { OR: [{ createdAt: { gte: since } }, { firedAt: { gte: since } }] } : {}),
    },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { responses: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    prompt: r.prompt,
    options: Array.isArray(r.options) ? (r.options as string[]) : null,
    correctOption: r.correctOption,
    explanation: r.explanation,
    intervalSeconds: r.intervalSeconds,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    firedAt: r.firedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    prePublishedAt: r.prePublishedAt?.toISOString() ?? null,
    responseCount: r._count.responses,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function recordHookResponse(input: {
  hookId: string;
  userId: string;
  response: string;
  latencyMs?: number;
}): Promise<{ isCorrect: boolean | null }> {
  const hook = await db.liveHook.findUnique({
    where: { id: input.hookId },
    select: {
      id: true,
      sessionId: true,
      correctOption: true,
      closedAt: true,
      firedAt: true,
      prePublishedAt: true,
      options: true,
      kind: true,
    },
  });
  if (!hook) throw new Error('Hook not found');
  if (hook.closedAt) throw new Error('Hook closed');
  // a draft hook (neither pre-published nor fired) is not visible to
  // residents and must not accept votes. The host shouldn't reach this path
  // either since their UI only shows published rows in the voter; this is a
  // defense-in-depth check against forged hookId requests.
  if (!hook.firedAt && !hook.prePublishedAt) {
    throw new Error('Hook not yet open for responses');
  }
  // For structured polls, the submitted response must be one of the
  // declared options. Free-form kinds (ONE_WORD / REPEAT_CONCEPT) accept
  // any string.
  if (hook.kind === LiveHookKind.POLL || hook.kind === LiveHookKind.TRUE_FALSE) {
    const opts = Array.isArray(hook.options) ? (hook.options as string[]) : [];
    if (!opts.includes(input.response)) {
      throw new Error('Response is not one of the offered options');
    }
  }

  const isCorrect = hook.correctOption == null ? null : hook.correctOption === input.response;
  await db.liveHookResponse.upsert({
    where: { hookId_userId: { hookId: hook.id, userId: input.userId } },
    create: {
      hookId: hook.id,
      userId: input.userId,
      response: input.response,
      isCorrect,
      latencyMs: input.latencyMs ?? null,
    },
    update: {
      response: input.response,
      isCorrect,
      latencyMs: input.latencyMs ?? null,
    },
  });

  await recordEngagementSignal({
    sessionId: hook.sessionId,
    userId: input.userId,
    kind: EngagementSignalKind.HOOK_RESPONSE,
    value: isCorrect == null ? 0 : isCorrect ? 1 : 0,
    metadata: { hookId: hook.id, response: input.response, latencyMs: input.latencyMs },
  });

  return { isCorrect };
}

export async function userCanCreateHook(
  sessionId: string,
  userId: string,
  role: Role
): Promise<boolean> {
  if (role === Role.ADMIN || role === Role.PROGRAM_DIRECTOR) return true;
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  return !!session && session.hostId === userId;
}

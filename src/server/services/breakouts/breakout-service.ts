// ════════════════════════════════════════════════════════════════════════════
// Breakout Service — W5
// ════════════════════════════════════════════════════════════════════════════
// Faculty splits a live session into N child rooms. Phase 1 modes:
//   - RANDOM: server shuffles candidate participants and partitions into N
//   - SELF_SELECT: empty rooms; participants claim a seat via /assignments
//   - AI_AUTO: schema-only in Phase 1, route returns 501 (ships W11)
//
// LiveKit child rooms are created via Server SDK with a deterministic name:
//   `session-<sessionId>-bk-<breakoutId>`. Tokens are minted per-participant
//   and returned to the client; the client disconnects from the parent room
//   and connects to the child room with the new token.
//
// Reconvene: end all ACTIVE breakouts on the session, delete LiveKit rooms,
// stamp endedAt + leftAt for active assignments. Clients then reconnect to
// the parent session room with their existing token.

import { db } from '@/lib/db';
import {
  BreakoutGroupingMode,
  BreakoutStatus,
  Role,
} from '@prisma/client';
import {
  createRoom,
  deleteRoom,
  mintLiveKitToken,
  sessionRoomName,
} from '@/lib/livekit';
import { env } from '@/lib/env';

export class BreakoutError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID'
      | 'FORBIDDEN'
      | 'NOT_LIVE'
      | 'AI_GROUPING_DEFERRED'
      | 'NOT_ASSIGNED'
      | 'BREAKOUT_ENDED',
    message: string
  ) {
    super(message);
  }
}

export interface BreakoutActor {
  userId: string;
  userName: string;
  role: Role;
}

export interface BreakoutView {
  id: string;
  sessionId: string;
  name: string;
  groupingMode: BreakoutGroupingMode;
  livekitRoomName: string;
  status: BreakoutStatus;
  participants: Array<{
    userId: string;
    name: string;
    joinedAt: string | null;
    leftAt: string | null;
  }>;
  createdAt: string;
  endedAt: string | null;
}

function breakoutRoomName(sessionId: string, breakoutId: string): string {
  return `${sessionRoomName(sessionId)}-bk-${breakoutId}`;
}

async function userIsHostOrPrivileged(
  actor: BreakoutActor,
  sessionId: string
): Promise<boolean> {
  if (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) return true;
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  return !!session && session.hostId === actor.userId;
}

async function requireLiveSession(sessionId: string): Promise<{
  id: string;
  hostId: string;
  status: string;
  breakoutsEnabled: boolean;
}> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true, status: true, breakoutsEnabled: true },
  });
  if (!session) throw new BreakoutError('NOT_FOUND', 'Session not found');
  if (session.status !== 'LIVE') {
    throw new BreakoutError('NOT_LIVE', 'Breakouts are only available during a LIVE session');
  }
  return session;
}

export interface CreateBreakoutsInput {
  sessionId: string;
  groupingMode: BreakoutGroupingMode;
  groupCount: number; // number of child rooms to create
  candidateUserIds?: string[]; // for RANDOM: who to partition (defaults to current participants)
  namePrefix?: string;
}

export async function createBreakouts(
  actor: BreakoutActor,
  input: CreateBreakoutsInput
): Promise<BreakoutView[]> {
  if (!(await userIsHostOrPrivileged(actor, input.sessionId))) {
    throw new BreakoutError('FORBIDDEN', 'Only host, PD, or admin can start breakouts');
  }
  if (input.groupingMode === BreakoutGroupingMode.AI_AUTO) {
    throw new BreakoutError(
      'AI_GROUPING_DEFERRED',
      'AI auto-grouping ships in W11 with the readiness predictor'
    );
  }
  if (input.groupCount < 1 || input.groupCount > 16) {
    throw new BreakoutError('INVALID', 'groupCount must be between 1 and 16');
  }

  await requireLiveSession(input.sessionId);

  // Resolve candidate participants for RANDOM mode (default = anyone currently
  // marked as participant on the session, excluding the host).
  let candidates: string[] = [];
  if (input.groupingMode === BreakoutGroupingMode.RANDOM) {
    if (input.candidateUserIds?.length) {
      candidates = input.candidateUserIds;
    } else {
      const participants = await db.sessionParticipant.findMany({
        where: { sessionId: input.sessionId },
        select: { userId: true },
      });
      candidates = participants.map((p) => p.userId).filter((id) => id !== actor.userId);
    }
    if (candidates.length === 0) {
      throw new BreakoutError('INVALID', 'No participants to assign for RANDOM grouping');
    }
  }

  // Fisher-Yates shuffle for deterministic-but-unbiased partition.
  if (input.groupingMode === BreakoutGroupingMode.RANDOM && candidates.length > 1) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  }

  const created: BreakoutView[] = [];
  for (let i = 0; i < input.groupCount; i++) {
    const breakout = await db.breakout.create({
      data: {
        sessionId: input.sessionId,
        createdById: actor.userId,
        name: `${input.namePrefix ?? 'Group'} ${i + 1}`,
        groupingMode: input.groupingMode,
        livekitRoomName: '__pending__', // overwritten below
      },
    });
    const roomName = breakoutRoomName(input.sessionId, breakout.id);
    await db.breakout.update({
      where: { id: breakout.id },
      data: { livekitRoomName: roomName },
    });
    // Pre-provisioning the LiveKit room is best-effort — LiveKit auto-creates
    // a room on first participant join, so a temporarily-unreachable LiveKit
    // server should not fail breakout creation. Mirrors reconvene's defensive
    // deleteRoom wrapper for symmetry.
    try {
      await createRoom(roomName, 30);
    } catch (err) {
      console.warn(`[breakouts] best-effort createRoom failed for ${roomName} — LiveKit will auto-create on first join:`, err);
    }

    // RANDOM: assign this slice of candidates to this breakout.
    if (input.groupingMode === BreakoutGroupingMode.RANDOM) {
      const sliceSize = Math.ceil(candidates.length / input.groupCount);
      const slice = candidates.slice(i * sliceSize, (i + 1) * sliceSize);
      if (slice.length) {
        await db.breakoutParticipant.createMany({
          data: slice.map((userId) => ({ breakoutId: breakout.id, userId })),
          skipDuplicates: true,
        });
      }
    }

    created.push(await loadBreakoutView(breakout.id));
  }

  return created;
}

async function loadBreakoutView(breakoutId: string): Promise<BreakoutView> {
  const b = await db.breakout.findUnique({
    where: { id: breakoutId },
    include: {
      participants: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!b) throw new BreakoutError('NOT_FOUND', 'Breakout not found');
  return {
    id: b.id,
    sessionId: b.sessionId,
    name: b.name,
    groupingMode: b.groupingMode,
    livekitRoomName: b.livekitRoomName,
    status: b.status,
    participants: b.participants.map((p) => ({
      userId: p.userId,
      name: p.user.name,
      joinedAt: p.joinedAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
    })),
    createdAt: b.createdAt.toISOString(),
    endedAt: b.endedAt?.toISOString() ?? null,
  };
}

export async function listBreakouts(sessionId: string): Promise<BreakoutView[]> {
  const rows = await db.breakout.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    include: {
      participants: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  return rows.map((b) => ({
    id: b.id,
    sessionId: b.sessionId,
    name: b.name,
    groupingMode: b.groupingMode,
    livekitRoomName: b.livekitRoomName,
    status: b.status,
    participants: b.participants.map((p) => ({
      userId: p.userId,
      name: p.user.name,
      joinedAt: p.joinedAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
    })),
    createdAt: b.createdAt.toISOString(),
    endedAt: b.endedAt?.toISOString() ?? null,
  }));
}

export async function assignParticipant(
  actor: BreakoutActor,
  sessionId: string,
  breakoutId: string,
  targetUserId: string
): Promise<void> {
  // Faculty can assign anyone; participant can only self-assign in SELF_SELECT.
  const breakout = await db.breakout.findUnique({
    where: { id: breakoutId },
    select: {
      id: true,
      sessionId: true,
      groupingMode: true,
      status: true,
    },
  });
  if (!breakout) throw new BreakoutError('NOT_FOUND', 'Breakout not found');
  if (breakout.sessionId !== sessionId) {
    throw new BreakoutError('INVALID', 'Breakout does not belong to this session');
  }
  if (breakout.status !== BreakoutStatus.ACTIVE) {
    throw new BreakoutError('BREAKOUT_ENDED', 'Breakout is no longer active');
  }

  const isPrivileged = await userIsHostOrPrivileged(actor, sessionId);
  if (!isPrivileged) {
    if (breakout.groupingMode !== BreakoutGroupingMode.SELF_SELECT) {
      throw new BreakoutError('FORBIDDEN', 'Only host can assign for non-SELF_SELECT modes');
    }
    if (targetUserId !== actor.userId) {
      throw new BreakoutError('FORBIDDEN', 'Participants can only self-assign');
    }
  }

  // Remove the user from any other ACTIVE breakouts on the same session,
  // then upsert into the target breakout.
  await db.$transaction(async (tx) => {
    await tx.breakoutParticipant.deleteMany({
      where: {
        userId: targetUserId,
        breakout: { sessionId, status: BreakoutStatus.ACTIVE, NOT: { id: breakoutId } },
      },
    });
    await tx.breakoutParticipant.upsert({
      where: { breakoutId_userId: { breakoutId, userId: targetUserId } },
      create: { breakoutId, userId: targetUserId },
      update: { leftAt: null },
    });
  });
}

export async function mintBreakoutToken(
  actor: BreakoutActor,
  sessionId: string,
  breakoutId: string
): Promise<{ token: string; url: string; roomName: string }> {
  const breakout = await db.breakout.findUnique({
    where: { id: breakoutId },
    select: {
      id: true,
      sessionId: true,
      status: true,
      livekitRoomName: true,
      participants: { where: { userId: actor.userId }, select: { userId: true } },
    },
  });
  if (!breakout) throw new BreakoutError('NOT_FOUND', 'Breakout not found');
  if (breakout.sessionId !== sessionId) {
    throw new BreakoutError('INVALID', 'Breakout does not belong to this session');
  }
  if (breakout.status !== BreakoutStatus.ACTIVE) {
    throw new BreakoutError('BREAKOUT_ENDED', 'Breakout has ended');
  }

  const isPrivileged = await userIsHostOrPrivileged(actor, sessionId);
  if (!isPrivileged && breakout.participants.length === 0) {
    throw new BreakoutError('NOT_ASSIGNED', 'You are not assigned to this breakout');
  }

  // Forward avatarUrl into LiveKit metadata so the breakout-room participant
  // tile can render the user's photo when their camera is off (parity with
  // the main session). Falls back to initials when null.
  const userRow = await db.user.findUnique({
    where: { id: actor.userId },
    select: { avatarUrl: true },
  });

  const token = await mintLiveKitToken({
    identity: actor.userId,
    name: actor.userName,
    roomName: breakout.livekitRoomName,
    role: isPrivileged ? 'host' : 'participant',
    canShareScreen: true, // breakouts are collaborative — everyone can share
    metadata: { avatarUrl: userRow?.avatarUrl ?? null },
  });

  // Mark joined-at if first time.
  await db.breakoutParticipant.upsert({
    where: { breakoutId_userId: { breakoutId, userId: actor.userId } },
    create: { breakoutId, userId: actor.userId, joinedAt: new Date() },
    update: { joinedAt: new Date(), leftAt: null },
  });

  return { token, url: env.LIVEKIT_URL, roomName: breakout.livekitRoomName };
}

export async function reconveneAll(
  actor: BreakoutActor,
  sessionId: string
): Promise<{ ended: number }> {
  if (!(await userIsHostOrPrivileged(actor, sessionId))) {
    throw new BreakoutError('FORBIDDEN', 'Only host, PD, or admin can reconvene');
  }
  const active = await db.breakout.findMany({
    where: { sessionId, status: BreakoutStatus.ACTIVE },
    select: { id: true, livekitRoomName: true },
  });
  if (!active.length) return { ended: 0 };

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.breakout.updateMany({
      where: { id: { in: active.map((b) => b.id) } },
      data: { status: BreakoutStatus.ENDED, endedAt: now, endedById: actor.userId },
    });
    await tx.breakoutParticipant.updateMany({
      where: { breakoutId: { in: active.map((b) => b.id) }, leftAt: null },
      data: { leftAt: now },
    });
  });

  // Best-effort delete of the LiveKit child rooms (LiveKit will also clean up
  // empty rooms on its own emptyTimeout, but explicit deletion disconnects
  // any stragglers immediately).
  for (const b of active) {
    try {
      await deleteRoom(b.livekitRoomName);
    } catch (err) {
      console.warn(`[breakouts] failed to delete LiveKit room ${b.livekitRoomName}:`, err);
    }
  }

  return { ended: active.length };
}

// ─── Agent log (W5: schema + ingest contract only — Python sidecar later) ────
// See docs/BREAKOUT-AGENT-CONTRACT.md.

export interface AgentLogIngestInput {
  breakoutId: string;
  kind: import('@prisma/client').BreakoutAgentLogKind;
  content: string;
  metadata?: Record<string, unknown>;
}

export async function ingestAgentLog(input: AgentLogIngestInput): Promise<{ id: string }> {
  const breakout = await db.breakout.findUnique({
    where: { id: input.breakoutId },
    select: { id: true, status: true },
  });
  if (!breakout) throw new BreakoutError('NOT_FOUND', 'Breakout not found');
  if (breakout.status !== BreakoutStatus.ACTIVE) {
    throw new BreakoutError('BREAKOUT_ENDED', 'Cannot ingest log for ended breakout');
  }
  const row = await db.breakoutAgentLog.create({
    data: {
      breakoutId: input.breakoutId,
      kind: input.kind,
      content: input.content,
      metadata: input.metadata ? (input.metadata as object) : undefined,
    },
    select: { id: true },
  });
  return row;
}

export async function listAgentLog(
  breakoutId: string
): Promise<
  Array<{
    id: string;
    kind: import('@prisma/client').BreakoutAgentLogKind;
    content: string;
    metadata: unknown;
    createdAt: string;
  }>
> {
  const rows = await db.breakoutAgentLog.findMany({
    where: { breakoutId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    content: r.content,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// Learning Objectives — service module
// ════════════════════════════════════════════════════════════════════════════
// Reads/writes the structured objectives that live on TeachingSession.objectives
// (Json) and the per-resident achievement marks in SessionObjectiveAchievement.
//
// Two surfaces:
//   - Curators (host / PD / admin) edit the objectives via the existing
//     PATCH /api/classroom/sessions/[id] route — see updateSession() in
//     session-service.ts. This module only reads + handles resident marks.
//   - Residents POST achievement marks for objectives they completed,
//     keyed by objectiveId (the cuid embedded in the Json).

import { db } from '@/lib/db';
import { Role, type ObjectiveAchievementStatus } from '@prisma/client';
import { userCanSeeSession } from './visibility';
import { emit } from '@/server/services/notifications-service';

export interface SessionObjective {
  id: string;
  text: string;
  blooms: number;
  epaTag: string | null;
}

export interface ObjectiveWithMyMark extends SessionObjective {
  myStatus: ObjectiveAchievementStatus | null;
  myNote: string | null;
  myMarkedAt: string | null;
}

export class ObjectivesAccessError extends Error {
  constructor(public code: 'NOT_FOUND' | 'FORBIDDEN' | 'OBJECTIVE_NOT_FOUND') {
    super(code);
  }
}

/**
 * Read objectives + the current user's marks. Anyone who can see the session
 * can read; orphan marks (whose objectiveId no longer exists in the Json) are
 * filtered out — surfacing them would confuse the resident with stale UI.
 */
export async function readObjectivesWithMyMarks(opts: {
  sessionId: string;
  actor: { userId: string; role: Role };
}): Promise<ObjectiveWithMyMark[]> {
  const visible = await userCanSeeSession(
    { userId: opts.actor.userId, role: opts.actor.role },
    opts.sessionId
  );
  if (!visible) throw new ObjectivesAccessError('FORBIDDEN');

  const session = await db.teachingSession.findUnique({
    where: { id: opts.sessionId },
    select: { objectives: true },
  });
  if (!session) throw new ObjectivesAccessError('NOT_FOUND');

  const raw = (session.objectives as unknown as SessionObjective[] | null) ?? [];
  if (raw.length === 0) return [];

  const marks = await db.sessionObjectiveAchievement.findMany({
    where: { sessionId: opts.sessionId, userId: opts.actor.userId },
    select: { objectiveId: true, status: true, note: true, updatedAt: true },
  });
  const markByObjectiveId = new Map(marks.map((m) => [m.objectiveId, m]));

  return raw.map((o) => {
    const m = markByObjectiveId.get(o.id);
    return {
      id: o.id,
      text: o.text,
      blooms: o.blooms,
      epaTag: o.epaTag ?? null,
      myStatus: m?.status ?? null,
      myNote: m?.note ?? null,
      myMarkedAt: m?.updatedAt.toISOString() ?? null,
    };
  });
}

/**
 * Upsert a resident's achievement mark for a single objective. The objective
 * must still exist in the session's Json; otherwise the resident is rejected
 * with OBJECTIVE_NOT_FOUND so we never write orphan rows.
 */
export async function markObjectiveAchievement(opts: {
  sessionId: string;
  actor: { userId: string; role: Role };
  objectiveId: string;
  status: ObjectiveAchievementStatus;
  note?: string | null;
}) {
  const visible = await userCanSeeSession(
    { userId: opts.actor.userId, role: opts.actor.role },
    opts.sessionId
  );
  if (!visible) throw new ObjectivesAccessError('FORBIDDEN');

  const session = await db.teachingSession.findUnique({
    where: { id: opts.sessionId },
    select: { objectives: true },
  });
  if (!session) throw new ObjectivesAccessError('NOT_FOUND');

  const raw = (session.objectives as unknown as SessionObjective[] | null) ?? [];
  if (!raw.some((o) => o.id === opts.objectiveId)) {
    throw new ObjectivesAccessError('OBJECTIVE_NOT_FOUND');
  }

  const prior = await db.sessionObjectiveAchievement.findUnique({
    where: {
      sessionId_userId_objectiveId: {
        sessionId: opts.sessionId,
        userId: opts.actor.userId,
        objectiveId: opts.objectiveId,
      },
    },
    select: { id: true },
  });
  const isFirstMark = !prior;

  const upserted = await db.sessionObjectiveAchievement.upsert({
    where: {
      sessionId_userId_objectiveId: {
        sessionId: opts.sessionId,
        userId: opts.actor.userId,
        objectiveId: opts.objectiveId,
      },
    },
    create: {
      sessionId: opts.sessionId,
      userId: opts.actor.userId,
      objectiveId: opts.objectiveId,
      status: opts.status,
      note: opts.note ?? null,
    },
    update: {
      status: opts.status,
      note: opts.note ?? null,
    },
    select: {
      id: true,
      objectiveId: true,
      status: true,
      note: true,
      updatedAt: true,
    },
  });

  // Notify the resident on their first mark for this objective so they get
  // an in-app confirmation. Repeat upserts (status changes) are silent.
  if (isFirstMark) {
    const objective = raw.find((o) => o.id === opts.objectiveId);
    if (objective) {
      await emit({
        userId: opts.actor.userId,
        kind: 'objective.achieved',
        title: `Objective marked as ${opts.status.toLowerCase().replace('_', ' ')}`,
        body: objective.text.length > 100 ? `${objective.text.slice(0, 97)}…` : objective.text,
        payload: {
          sessionId: opts.sessionId,
          objectiveId: opts.objectiveId,
          status: opts.status,
        },
      });
    }
  }

  return {
    achievementId: upserted.id,
    objectiveId: upserted.objectiveId,
    status: upserted.status,
    note: upserted.note,
    markedAt: upserted.updatedAt.toISOString(),
  };
}

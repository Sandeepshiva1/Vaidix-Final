// ════════════════════════════════════════════════════════════════════════════
// Session prerequisite gate — computes whether a learner has met the prep
// work the host configured before "Join now" unlocks.
// ════════════════════════════════════════════════════════════════════════════
// Prereq config lives in TeachingSession.metadata.prereq (no new columns).
// All progress signals reuse existing tables — PreSessionQuestion,
// DocumentSessionLink, SessionPreCase, StudyPackView, SessionObjectiveAchievement.

import { db } from '@/lib/db';
import {
  DEFAULT_PREREQ_CONFIG,
  prereqConfigSchema,
  type PrereqConfig,
} from '@/lib/validation/session';

interface StoredObjective {
  id: string;
  text: string;
  blooms: number;
}

export interface PrereqCheck {
  required: boolean;
  met: boolean;
  current: number;
  total: number;
}

export interface PrereqStatus {
  mode: PrereqConfig['mode'];
  config: PrereqConfig;
  checks: {
    preQuestions: PrereqCheck;
    studyPack: PrereqCheck;
    readinessAck: PrereqCheck;
  };
  // True when the gate should let the user join. NONE/OPTIONAL always pass;
  // MANDATORY passes only if every required check is met.
  allMet: boolean;
  // True when the host has at least one mandatory check enabled — used by the
  // UI to decide whether to render the prereq panel at all.
  hasGate: boolean;
}

export function readPrereqConfig(metadata: unknown): PrereqConfig {
  if (!metadata || typeof metadata !== 'object') return { ...DEFAULT_PREREQ_CONFIG };
  const raw = (metadata as Record<string, unknown>).prereq;
  if (!raw) return { ...DEFAULT_PREREQ_CONFIG };
  const parsed = prereqConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_PREREQ_CONFIG };
}

export async function computePrereqStatus(
  sessionId: string,
  userId: string,
): Promise<PrereqStatus> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { metadata: true, objectives: true },
  });

  const config = readPrereqConfig(session?.metadata);
  const objectives = (session?.objectives as unknown as StoredObjective[] | null) ?? [];

  const [preQCount, preDocs, preCases, viewedDocLinks, viewedCases, ackedCount] =
    await Promise.all([
      db.preSessionQuestion.count({ where: { sessionId, userId } }),
      db.documentSessionLink.count({ where: { sessionId, isPreSession: true } }),
      db.sessionPreCase.count({ where: { sessionId } }),
      // Distinct doc-link items this user has opened.
      db.studyPackView.findMany({
        where: { sessionId, userId, documentLinkId: { not: null } },
        select: { documentLinkId: true },
        distinct: ['documentLinkId'],
      }),
      db.studyPackView.findMany({
        where: { sessionId, userId, preCaseId: { not: null } },
        select: { preCaseId: true },
        distinct: ['preCaseId'],
      }),
      db.sessionObjectiveAchievement.count({ where: { sessionId, userId } }),
    ]);

  const studyPackTotal = preDocs + preCases;
  const studyPackViewed = viewedDocLinks.length + viewedCases.length;

  const preQCheck: PrereqCheck = {
    required: config.requirePreQuestions,
    current: preQCount,
    total: config.minPreQuestions,
    met: preQCount >= config.minPreQuestions,
  };
  const studyPackCheck: PrereqCheck = {
    required: config.requireStudyPack,
    current: Math.min(studyPackViewed, studyPackTotal),
    total: studyPackTotal,
    met: studyPackTotal === 0 ? true : studyPackViewed >= studyPackTotal,
  };
  const readinessCheck: PrereqCheck = {
    required: config.requireReadinessAck,
    current: Math.min(ackedCount, objectives.length),
    total: objectives.length,
    met: objectives.length === 0 ? true : ackedCount >= objectives.length,
  };

  const requiredChecks = [
    config.requirePreQuestions ? preQCheck.met : true,
    config.requireStudyPack ? studyPackCheck.met : true,
    config.requireReadinessAck ? readinessCheck.met : true,
  ];

  const allRequiredMet = requiredChecks.every(Boolean);
  const hasGate =
    config.mode === 'MANDATORY' &&
    (config.requirePreQuestions || config.requireStudyPack || config.requireReadinessAck);

  return {
    mode: config.mode,
    config,
    checks: {
      preQuestions: preQCheck,
      studyPack: studyPackCheck,
      readinessAck: readinessCheck,
    },
    allMet: hasGate ? allRequiredMet : true,
    hasGate,
  };
}

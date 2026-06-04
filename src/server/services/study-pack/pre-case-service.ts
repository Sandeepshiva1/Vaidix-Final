// ════════════════════════════════════════════════════════════════════════════
// Pre-Case Service
// ════════════════════════════════════════════════════════════════════════════
// Faculty curate which `CaseTemplate`s are pre-session prep for a given
// `TeachingSession`. Residents see them in the Study Pack, click "Start" →
// idempotently land on a `Case` (their attempt) using the existing cases
// engine. Completion of the case produces an EngagementSignal that the
// readiness predictor picks up.
//
// `required` is a SOFT signal — joining the live session is never blocked.
// Project pedagogy is "difficult but fair" (project_vaidix.md memory), and
// the user explicitly chose "Soft nudge" over "Hard block" during planning.

import { db } from '@/lib/db';
import {
  CaseStatus,
  ConversationStatus,
  Role,
  type CaseDifficulty,
} from '@prisma/client';
import { startCase as startCaseFromTemplate, CasesError } from '@/server/services/cases/cases-service';
import {
  userCanSeeSession,
  userIsHostOrPrivileged,
} from '@/server/services/sessions/visibility';

export class PreCaseAccessError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'CONFLICT',
    message: string
  ) {
    super(message);
  }
}

export interface PreCaseActor {
  userId: string;
  role: Role;
}

// ─── Curation ───────────────────────────────────────────────────────────────
export interface AttachPreCaseInput {
  sessionId: string;
  caseTemplateId: string;
  rank?: number;
  required?: boolean;
  actor: PreCaseActor;
}

export async function attachPreCase(
  input: AttachPreCaseInput
): Promise<{ preCaseId: string }> {
  if (!(await userIsHostOrPrivileged(input.actor, input.sessionId))) {
    throw new PreCaseAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can attach pre-cases'
    );
  }
  const tpl = await db.caseTemplate.findUnique({
    where: { id: input.caseTemplateId },
    select: { id: true, publishedAt: true, programId: true },
  });
  if (!tpl) {
    throw new PreCaseAccessError('NOT_FOUND', 'Case template not found');
  }
  // the template must belong to the session's program. Cross-tenant
  // attachment would let a Cornea Fellowship faculty pull MS Ophthalmology
  // templates into their session, leaking content.
  const sess = await db.teachingSession.findUnique({
    where: { id: input.sessionId },
    select: { programId: true },
  });
  if (!sess || sess.programId !== tpl.programId) {
    throw new PreCaseAccessError('NOT_FOUND', 'Case template is from a different program');
  }
  // Idempotent guard — the unique index would also enforce this, but a clean
  // 409 with the existing id is friendlier than a Prisma exception.
  const existing = await db.sessionPreCase.findUnique({
    where: {
      sessionId_caseTemplateId: {
        sessionId: input.sessionId,
        caseTemplateId: input.caseTemplateId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { preCaseId: existing.id };
  }
  const created = await db.sessionPreCase.create({
    data: {
      sessionId: input.sessionId,
      caseTemplateId: input.caseTemplateId,
      assignedById: input.actor.userId,
      rank: typeof input.rank === 'number' ? input.rank : 0,
      required: !!input.required,
    },
    select: { id: true },
  });
  return { preCaseId: created.id };
}

export interface DetachPreCaseInput {
  sessionId: string;
  preCaseId: string;
  actor: PreCaseActor;
}

export interface UpdatePreCaseInput {
  sessionId: string;
  preCaseId: string;
  required?: boolean;
  rank?: number;
  actor: PreCaseActor;
}

/**
 * Update a SessionPreCase's curator-controlled fields. Currently surfaces
 * `required` (mandatory vs optional) and `rank` (display order). Idempotent —
 * a no-op input simply returns the row's current state.
 */
export async function updatePreCase(input: UpdatePreCaseInput): Promise<void> {
  if (!(await userIsHostOrPrivileged(input.actor, input.sessionId))) {
    throw new PreCaseAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can update pre-cases'
    );
  }
  const row = await db.sessionPreCase.findFirst({
    where: { id: input.preCaseId, sessionId: input.sessionId },
    select: { id: true },
  });
  if (!row) throw new PreCaseAccessError('NOT_FOUND', 'Pre-case not found for this session');

  const data: { required?: boolean; rank?: number } = {};
  if (typeof input.required === 'boolean') data.required = input.required;
  if (typeof input.rank === 'number') data.rank = input.rank;
  if (Object.keys(data).length === 0) return;
  await db.sessionPreCase.update({ where: { id: row.id }, data });
}

export async function detachPreCase(input: DetachPreCaseInput): Promise<void> {
  if (!(await userIsHostOrPrivileged(input.actor, input.sessionId))) {
    throw new PreCaseAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can detach pre-cases'
    );
  }
  const row = await db.sessionPreCase.findFirst({
    where: { id: input.preCaseId, sessionId: input.sessionId },
    select: { id: true },
  });
  if (!row) throw new PreCaseAccessError('NOT_FOUND', 'Pre-case not found for this session');
  await db.sessionPreCase.delete({ where: { id: row.id } });
}

// ─── Listing ────────────────────────────────────────────────────────────────
export interface PreCaseCuratorView {
  preCaseId: string;
  caseTemplateId: string;
  title: string;
  condition: string;
  difficulty: CaseDifficulty;
  bloomsLevel: number;
  estimatedMinutes: number;
  rank: number;
  required: boolean;
  attachedAt: string;
  /** Distinct learner attempts that exist in the COMPLETED state (for at-a-glance progress). */
  completedByCount: number;
}

export async function listPreCasesForCurator(
  sessionId: string,
  actor: PreCaseActor
): Promise<PreCaseCuratorView[]> {
  if (!(await userIsHostOrPrivileged(actor, sessionId))) {
    throw new PreCaseAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can view the curator list'
    );
  }
  const rows = await db.sessionPreCase.findMany({
    where: { sessionId },
    orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      rank: true,
      required: true,
      createdAt: true,
      caseTemplate: {
        select: {
          id: true,
          title: true,
          condition: true,
          difficulty: true,
          bloomsLevel: true,
          estimatedMinutes: true,
        },
      },
    },
  });
  if (rows.length === 0) return [];
  // Compute completedBy counts in one pass for all templates.
  const templateIds = rows.map((r) => r.caseTemplate.id);
  const grouped = await db.case.groupBy({
    by: ['templateId'],
    where: {
      templateId: { in: templateIds },
      status: CaseStatus.COMPLETED,
    },
    _count: { _all: true },
  });
  const completedByTemplate = new Map<string, number>();
  for (const g of grouped) {
    if (g.templateId) completedByTemplate.set(g.templateId, g._count._all);
  }
  return rows.map((r) => ({
    preCaseId: r.id,
    caseTemplateId: r.caseTemplate.id,
    title: r.caseTemplate.title,
    condition: r.caseTemplate.condition,
    difficulty: r.caseTemplate.difficulty,
    bloomsLevel: r.caseTemplate.bloomsLevel,
    estimatedMinutes: r.caseTemplate.estimatedMinutes,
    rank: r.rank,
    required: r.required,
    attachedAt: r.createdAt.toISOString(),
    completedByCount: completedByTemplate.get(r.caseTemplate.id) ?? 0,
  }));
}

export interface PreCaseLearnerView {
  preCaseId: string;
  caseTemplateId: string;
  title: string;
  condition: string;
  difficulty: CaseDifficulty;
  bloomsLevel: number;
  estimatedMinutes: number;
  rank: number;
  required: boolean;
  /** The learner's most recent attempt of this template (if any). */
  myCaseId: string | null;
  myCaseStatus: CaseStatus | null;
  myConversationStatus: ConversationStatus | null;
}

export async function listPreCasesForLearner(
  sessionId: string,
  actor: PreCaseActor
): Promise<PreCaseLearnerView[]> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new PreCaseAccessError(
      'FORBIDDEN',
      'No visibility into this session'
    );
  }
  const rows = await db.sessionPreCase.findMany({
    where: { sessionId },
    orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      rank: true,
      required: true,
      caseTemplate: {
        select: {
          id: true,
          title: true,
          condition: true,
          difficulty: true,
          bloomsLevel: true,
          estimatedMinutes: true,
        },
      },
    },
  });
  if (rows.length === 0) return [];

  const templateIds = rows.map((r) => r.caseTemplate.id);
  const myCases = await db.case.findMany({
    where: {
      residentId: actor.userId,
      templateId: { in: templateIds },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      templateId: true,
      status: true,
      conversations: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { status: true },
      },
    },
  });
  const latestByTemplate = new Map<string, { caseId: string; status: CaseStatus; convStatus: ConversationStatus | null }>();
  for (const c of myCases) {
    if (!c.templateId) continue;
    if (latestByTemplate.has(c.templateId)) continue; // already most recent (orderBy desc)
    latestByTemplate.set(c.templateId, {
      caseId: c.id,
      status: c.status,
      convStatus: c.conversations[0]?.status ?? null,
    });
  }

  return rows.map((r) => {
    const mine = latestByTemplate.get(r.caseTemplate.id);
    return {
      preCaseId: r.id,
      caseTemplateId: r.caseTemplate.id,
      title: r.caseTemplate.title,
      condition: r.caseTemplate.condition,
      difficulty: r.caseTemplate.difficulty,
      bloomsLevel: r.caseTemplate.bloomsLevel,
      estimatedMinutes: r.caseTemplate.estimatedMinutes,
      rank: r.rank,
      required: r.required,
      myCaseId: mine?.caseId ?? null,
      myCaseStatus: mine?.status ?? null,
      myConversationStatus: mine?.convStatus ?? null,
    };
  });
}

// ─── Start a learner attempt (idempotent) ───────────────────────────────────
export interface StartPreCaseInput {
  sessionId: string;
  preCaseId: string;
  actor: PreCaseActor;
}

export interface StartPreCaseResult {
  caseId: string;
  conversationId: string;
  reused: boolean;
}

export async function startPreCaseAttempt(
  input: StartPreCaseInput
): Promise<StartPreCaseResult> {
  if (!(await userCanSeeSession(input.actor, input.sessionId))) {
    throw new PreCaseAccessError(
      'FORBIDDEN',
      'No visibility into this session'
    );
  }
  const preCase = await db.sessionPreCase.findFirst({
    where: { id: input.preCaseId, sessionId: input.sessionId },
    select: {
      caseTemplate: { select: { id: true, programId: true } },
      session: { select: { programId: true } },
    },
  });
  if (!preCase) {
    throw new PreCaseAccessError('NOT_FOUND', 'Pre-case not found for this session');
  }
  // defense-in-depth. attachPreCase already validates this at write
  // time, but re-check at read so a hand-edited DB row can't bypass tenancy.
  if (preCase.caseTemplate.programId !== preCase.session.programId) {
    throw new PreCaseAccessError('NOT_FOUND', 'Pre-case template program mismatch');
  }

  // If the resident already has an ACTIVE attempt of this template, reuse it
  // — sending them to a fresh case every click would discard their progress.
  const existing = await db.case.findFirst({
    where: {
      residentId: input.actor.userId,
      templateId: preCase.caseTemplate.id,
      status: CaseStatus.ACTIVE,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      conversations: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (existing && existing.conversations[0]) {
    return {
      caseId: existing.id,
      conversationId: existing.conversations[0].id,
      reused: true,
    };
  }

  // Otherwise create a fresh attempt by reusing the cases-service path.
  try {
    const created = await startCaseFromTemplate(
      { userId: input.actor.userId, role: input.actor.role },
      preCase.caseTemplate.id,
      preCase.session.programId,
    );
    return { caseId: created.caseId, conversationId: created.conversationId, reused: false };
  } catch (err) {
    if (err instanceof CasesError && err.code === 'NOT_FOUND') {
      throw new PreCaseAccessError('NOT_FOUND', 'Underlying case template was deleted');
    }
    throw err;
  }
}

// ─── Aggregation helper for the readiness predictor ─────────────────────────
/** Returns per-learner counts of (assigned, completed) pre-cases. */
export async function aggregateLearnerPreCases(
  sessionId: string,
  learnerIds: string[]
): Promise<Map<string, { assigned: number; completed: number }>> {
  const out = new Map<string, { assigned: number; completed: number }>();
  for (const id of learnerIds) {
    out.set(id, { assigned: 0, completed: 0 });
  }
  const preCases = await db.sessionPreCase.findMany({
    where: { sessionId },
    select: { caseTemplate: { select: { id: true } } },
  });
  if (preCases.length === 0) return out;
  const templateIds = preCases.map((p) => p.caseTemplate.id);
  for (const slot of out.values()) slot.assigned = templateIds.length;

  // Pull completions in one query.
  const completions = await db.case.findMany({
    where: {
      residentId: { in: learnerIds },
      templateId: { in: templateIds },
      status: CaseStatus.COMPLETED,
    },
    select: { residentId: true, templateId: true },
  });
  // De-dupe per (resident, template) — a resident may have re-attempted a case.
  const seen = new Set<string>();
  for (const c of completions) {
    const key = `${c.residentId}|${c.templateId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slot = out.get(c.residentId);
    if (slot) slot.completed += 1;
  }
  return out;
}

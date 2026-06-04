// ════════════════════════════════════════════════════════════════════════════
// GET / PATCH /api/classroom/sessions/[id]/learners
// POST /api/classroom/sessions/[id]/learners/generate  (see ?action=generate)
// ════════════════════════════════════════════════════════════════════════════
// Persists the faculty-authored "Prepare Learners" config for a session. There
// is no dedicated model — the config lives on TeachingSession.metadata under the
// `learnerPrep` key:
//
//   metadata.learnerPrep = {
//     lockUntilPreread: boolean
//     collectAnalytics:  boolean
//     mcqs:     Array<{ id, q, options: string[], correct: number }>
//     openEnded: Array<{ id, q }>
//     updatedAt: ISO string
//   }
//
// GET returns the current config (defaults if none saved). PATCH saves it.
// POST attempts AI generation of study artifacts (flashcards / microlearning /
// infographics) — there is no generator backend wired in this environment, so
// it honestly returns 503 GENERATOR_OFFLINE and the client degrades gracefully.
//
// Access: session host or FACULTY / PROGRAM_DIRECTOR / ADMIN only. Mutations
// require the CSRF double-submit token.

import { z } from 'zod';
import { Prisma, Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { GeminiUnavailableError } from '@/server/services/ai/gemini';
import {
  generateStudyArtifacts,
  type StudyArtifacts,
} from '@/server/services/learners/study-artifacts-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const mcqSchema = z.object({
  id: z.string().min(1),
  q: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(500)).min(2).max(6),
  correct: z.number().int().min(0),
});

const openEndedSchema = z.object({
  id: z.string().min(1),
  q: z.string().min(1).max(2000),
});

const patchSchema = z.object({
  lockUntilPreread: z.boolean(),
  collectAnalytics: z.boolean(),
  mcqs: z.array(mcqSchema).max(50),
  openEnded: z.array(openEndedSchema).max(50),
});

export interface LearnerPrepConfig {
  lockUntilPreread: boolean;
  collectAnalytics: boolean;
  mcqs: Array<{ id: string; q: string; options: string[]; correct: number }>;
  openEnded: Array<{ id: string; q: string }>;
  /** AI-generated study artifacts (flashcards / microlearning / infographics). */
  artifacts?: StudyArtifacts;
  updatedAt?: string;
}

const DEFAULT_CONFIG: LearnerPrepConfig = {
  lockUntilPreread: true,
  collectAnalytics: true,
  mcqs: [],
  openEnded: [],
};

/** Pull a well-formed learnerPrep object out of an unknown metadata JSON blob. */
export function readLearnerPrep(metadata: unknown): LearnerPrepConfig {
  if (!metadata || typeof metadata !== 'object') return { ...DEFAULT_CONFIG };
  const lp = (metadata as Record<string, unknown>).learnerPrep;
  if (!lp || typeof lp !== 'object') return { ...DEFAULT_CONFIG };
  const o = lp as Record<string, unknown>;
  return {
    lockUntilPreread:
      typeof o.lockUntilPreread === 'boolean' ? o.lockUntilPreread : DEFAULT_CONFIG.lockUntilPreread,
    collectAnalytics:
      typeof o.collectAnalytics === 'boolean' ? o.collectAnalytics : DEFAULT_CONFIG.collectAnalytics,
    mcqs: Array.isArray(o.mcqs) ? (o.mcqs as LearnerPrepConfig['mcqs']) : [],
    openEnded: Array.isArray(o.openEnded) ? (o.openEnded as LearnerPrepConfig['openEnded']) : [],
    artifacts: readArtifacts(o.artifacts),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : undefined,
  };
}

/** Pull a well-formed StudyArtifacts object out of stored metadata, or undefined. */
function readArtifacts(value: unknown): StudyArtifacts | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const flashcards = Array.isArray(o.flashcards)
    ? (o.flashcards as StudyArtifacts['flashcards'])
    : [];
  const microlearning = Array.isArray(o.microlearning)
    ? (o.microlearning as StudyArtifacts['microlearning'])
    : [];
  const infographics = Array.isArray(o.infographics)
    ? (o.infographics as StudyArtifacts['infographics'])
    : [];
  if (flashcards.length === 0 && microlearning.length === 0 && infographics.length === 0) {
    return undefined;
  }
  return { flashcards, microlearning, infographics };
}

async function loadGate(sessionId: string, userId: string, role: Role) {
  const row = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true, metadata: true },
  });
  if (!row) return { ok: false as const, response: jsonError('NOT_FOUND', 'Session not found', 404) };
  const isHost = row.hostId === userId;
  if (!isHost && !FACULTY_LIKE.includes(role)) {
    return { ok: false as const, response: jsonError('FORBIDDEN', 'Faculty or host only', 403) };
  }
  return { ok: true as const, row };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  try {
    const gate = await loadGate(sessionId, auth.user.id, auth.user.role);
    if (!gate.ok) return gate.response;
    return jsonOk({ sessionId, config: readLearnerPrep(gate.row.metadata) });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;

  try {
    const gate = await loadGate(sessionId, auth.user.id, auth.user.role);
    if (!gate.ok) return gate.response;

    // Reject MCQs whose `correct` index is out of range for their options.
    for (const m of body.data.mcqs) {
      if (m.correct >= m.options.length) {
        return jsonError('VALIDATION_ERROR', 'MCQ correct index out of range', 422);
      }
    }

    // Preserve any previously generated AI artifacts — PATCH only edits the
    // faculty-authored fields and must not clobber them.
    const prevArtifacts = readLearnerPrep(gate.row.metadata).artifacts;
    const config: LearnerPrepConfig = {
      lockUntilPreread: body.data.lockUntilPreread,
      collectAnalytics: body.data.collectAnalytics,
      mcqs: body.data.mcqs,
      openEnded: body.data.openEnded,
      ...(prevArtifacts ? { artifacts: prevArtifacts } : {}),
      updatedAt: new Date().toISOString(),
    };

    // Merge into existing metadata so we never clobber sibling keys.
    const existing =
      gate.row.metadata && typeof gate.row.metadata === 'object'
        ? (gate.row.metadata as Record<string, unknown>)
        : {};

    await db.teachingSession.update({
      where: { id: sessionId },
      data: {
        metadata: { ...existing, learnerPrep: config } as unknown as Prisma.InputJsonValue,
      },
    });

    return jsonOk({ sessionId, config });
  } catch (err) {
    return handleUnexpected(err);
  }
}

// AI artifact generation (flashcards / microlearning / infographics). Grounds
// on the session topic + linked preread titles and calls Gemini for real. When
// the AI provider is unreachable / unconfigured (e.g. network-blocked envs) we
// honestly report the builder is offline with a 503 instead of fabricating
// content. The client surfaces an inline "AI builder offline" state on 503.
const generateSchema = z.object({ kind: z.literal('all').optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  // Body is optional; tolerate empty/missing JSON. Only `{ kind?: 'all' }` is read.
  await parseBody(req, generateSchema).catch(() => undefined);
  const { id: sessionId } = await ctx.params;
  try {
    const gate = await loadGate(sessionId, auth.user.id, auth.user.role);
    if (!gate.ok) return gate.response;

    let artifacts: StudyArtifacts;
    try {
      artifacts = await generateStudyArtifacts({ sessionId });
    } catch (err) {
      if (err instanceof GeminiUnavailableError) {
        console.error('[learners] study-artifact AI unavailable', err.detail);
        return jsonError(
          'GENERATOR_OFFLINE',
          'The AI study-artifact builder is offline — generation is unavailable right now.',
          503,
        );
      }
      throw err;
    }

    // Persist under metadata.learnerPrep.artifacts, merging so we never clobber
    // sibling keys (lock/analytics/mcqs/openEnded) or other metadata keys.
    const existingMeta =
      gate.row.metadata && typeof gate.row.metadata === 'object'
        ? (gate.row.metadata as Record<string, unknown>)
        : {};
    const prep = readLearnerPrep(gate.row.metadata);
    const nextPrep: LearnerPrepConfig = { ...prep, artifacts, updatedAt: new Date().toISOString() };

    await db.teachingSession.update({
      where: { id: sessionId },
      data: {
        metadata: { ...existingMeta, learnerPrep: nextPrep } as unknown as Prisma.InputJsonValue,
      },
    });

    return jsonOk({ sessionId, artifacts });
  } catch (err) {
    return handleUnexpected(err);
  }
}

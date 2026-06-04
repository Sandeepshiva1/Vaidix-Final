// ════════════════════════════════════════════════════════════════════════════
// /api/classroom/sessions/[id]/pre-cases — W6.8
// ════════════════════════════════════════════════════════════════════════════
// GET  → list pre-cases (curator view for host/PD/admin, learner view otherwise)
// POST → attach a CaseTemplate as pre-session prep (host/PD/admin only)

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  attachPreCase,
  listPreCasesForCurator,
  listPreCasesForLearner,
  PreCaseAccessError,
} from '@/server/services/study-pack/pre-case-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';

function statusFor(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'CONFLICT') return 409;
  return 400;
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const actor = { userId: auth.user.id, role: auth.user.role };
  try {
    if (FACULTY_LIKE.includes(auth.user.role)) {
      const items = await listPreCasesForCurator(sessionId, actor);
      return jsonOk({ sessionId, items, view: 'curator' });
    }
    const items = await listPreCasesForLearner(sessionId, actor);
    return jsonOk({ sessionId, items, view: 'learner' });
  } catch (err) {
    if (err instanceof PreCaseAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

const attachSchema = z.object({
  caseTemplateId: z.string().min(1),
  rank: z.number().int().nonnegative().optional(),
  required: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, attachSchema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;
  try {
    const result = await attachPreCase({
      sessionId,
      caseTemplateId: body.data.caseTemplateId,
      rank: body.data.rank,
      required: body.data.required,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PRE_CASE_ATTACHED,
      entityType: 'SessionPreCase',
      entityId: result.preCaseId,
      summary: `Pre-case attached to session`,
      details: {
        sessionId,
        caseTemplateId: body.data.caseTemplateId,
        rank: body.data.rank,
        required: !!body.data.required,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof PreCaseAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/classroom/sessions/[id]/pre-cases/[preCaseId] — W6.8
// ════════════════════════════════════════════════════════════════════════════
// Detach a CaseTemplate from a session's pre-case prep list. The underlying
// CaseTemplate is untouched; resident attempts (Case rows) are also untouched.
// Only the SessionPreCase join row is deleted.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  detachPreCase,
  updatePreCase,
  PreCaseAccessError,
} from '@/server/services/study-pack/pre-case-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';

const updateSchema = z
  .object({
    required: z.boolean().optional(),
    rank: z.number().int().min(0).max(999).optional(),
  })
  .refine((d) => d.required !== undefined || d.rank !== undefined, {
    message: 'At least one of `required` or `rank` must be provided',
  });

function statusFor(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'CONFLICT') return 409;
  return 400;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; preCaseId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId, preCaseId } = await ctx.params;
  const body = await parseBody(req, updateSchema);
  if (!body.ok) return body.response;
  try {
    await updatePreCase({
      sessionId,
      preCaseId,
      required: body.data.required,
      rank: body.data.rank,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PRE_CASE_UPDATED,
      entityType: 'SessionPreCase',
      entityId: preCaseId,
      summary: `Pre-case ${preCaseId} updated`,
      details: { sessionId, preCaseId, ...body.data },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ updated: true });
  } catch (err) {
    if (err instanceof PreCaseAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; preCaseId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId, preCaseId } = await ctx.params;
  try {
    await detachPreCase({
      sessionId,
      preCaseId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PRE_CASE_DETACHED,
      entityType: 'SessionPreCase',
      entityId: preCaseId,
      summary: `Pre-case detached from session`,
      details: { sessionId, preCaseId },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ removed: true });
  } catch (err) {
    if (err instanceof PreCaseAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

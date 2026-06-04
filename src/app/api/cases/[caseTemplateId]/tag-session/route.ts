// POST /api/cases/[caseTemplateId]/tag-session — link a case as a pre-session
// case for a teaching session. Creates / upserts a SessionPreCase row.
// Body: { sessionId, required?, rank? }
//
// Only the case owner (faculty who forged/authored it) or admin can link.
// The case must be PUBLISHED — drafts cannot be assigned to residents.

import { z } from 'zod';
import { Role, CaseTemplateStatus } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const bodySchema = z.object({
  sessionId: z.string().min(1),
  required: z.boolean().optional(),
  rank: z.number().int().min(0).max(20).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ caseTemplateId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { caseTemplateId } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const tpl = await db.caseTemplate.findUnique({
    where: { id: caseTemplateId },
    select: { id: true, ownerId: true, status: true, programId: true, title: true },
  });
  if (!tpl) return jsonError('NOT_FOUND', 'Case not found', 404);
  if (
    tpl.ownerId !== auth.user.id &&
    auth.user.role !== Role.ADMIN &&
    auth.user.role !== Role.PROGRAM_DIRECTOR
  ) {
    return jsonError('FORBIDDEN', 'Not your case', 403);
  }
  if (tpl.status !== CaseTemplateStatus.PUBLISHED) {
    return jsonError(
      'NOT_PUBLISHED',
      'Cases must be published before they can be assigned to a session',
      400,
    );
  }

  const session = await db.teachingSession.findUnique({
    where: { id: body.data.sessionId },
    select: { id: true, programId: true, deletedAt: true, title: true },
  });
  if (!session || session.deletedAt) {
    return jsonError('SESSION_NOT_FOUND', 'Session not found', 404);
  }
  if (session.programId !== tpl.programId) {
    return jsonError(
      'CROSS_PROGRAM',
      'Case template and session must belong to the same program',
      400,
    );
  }

  try {
    await db.sessionPreCase.upsert({
      where: {
        sessionId_caseTemplateId: {
          sessionId: session.id,
          caseTemplateId: tpl.id,
        },
      },
      create: {
        sessionId: session.id,
        caseTemplateId: tpl.id,
        assignedById: auth.user.id,
        required: body.data.required ?? true,
        rank: body.data.rank ?? 0,
      },
      update: {
        required: body.data.required ?? undefined,
        rank: body.data.rank ?? undefined,
      },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.CASE_TEMPLATE_PUBLISHED, // closest existing event
      entityType: 'CaseTemplate',
      entityId: tpl.id,
      summary: `Linked case "${tpl.title}" to session "${session.title}"`,
      details: { sessionId: session.id, required: body.data.required ?? true },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ linked: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

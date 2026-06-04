// W6 P2 — fetch one case-library template (by id or legacyId)
// W8 — extended with PATCH for owner edits.

import { z } from 'zod';
import { Role, CaseDifficulty } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireAuth,
  requireAuthWithProgram,
  requireCsrf,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getCaseTemplate, CasesError } from '@/server/services/cases/cases-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function GET(_req: Request, ctx: { params: Promise<{ caseTemplateId: string }> }) {
  try {
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const { caseTemplateId } = await ctx.params;
    const t = await getCaseTemplate(caseTemplateId, gate.user.activeProgramId);
    return jsonOk(t);
  } catch (err) {
    if (err instanceof CasesError && err.code === 'NOT_FOUND') {
      return jsonError('NOT_FOUND', err.message, 404);
    }
    return handleUnexpected(err);
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  condition: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().min(2).max(600).optional(),
  patientName: z.string().trim().min(1).max(80).optional(),
  patientAgeYears: z.number().int().min(0).max(110).optional(),
  patientSex: z.enum(['M', 'F']).optional(),
  patientPresentingComplaint: z.string().trim().min(2).max(600).optional(),
  bloomsLevel: z.number().int().min(1).max(6).optional(),
  difficulty: z.nativeEnum(CaseDifficulty).optional(),
  estimatedMinutes: z.number().int().min(5).max(120).optional(),
  isEmergency: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  oslerianPrinciples: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ caseTemplateId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { caseTemplateId } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const tpl = await db.caseTemplate.findUnique({
    where: { id: caseTemplateId },
    select: { ownerId: true, status: true },
  });
  if (!tpl) return jsonError('NOT_FOUND', 'Case not found', 404);
  if (tpl.ownerId !== auth.user.id && auth.user.role !== Role.ADMIN) {
    return jsonError('FORBIDDEN', 'Not your case', 403);
  }

  try {
    await db.caseTemplate.update({
      where: { id: caseTemplateId },
      data: body.data,
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.CASE_TEMPLATE_EDITED,
      entityType: 'CaseTemplate',
      entityId: caseTemplateId,
      summary: `Edited fields: ${Object.keys(body.data).join(', ')}`,
      details: { fields: Object.keys(body.data) },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ updated: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

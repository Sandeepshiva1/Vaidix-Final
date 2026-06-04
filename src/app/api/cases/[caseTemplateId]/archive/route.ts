// POST /api/cases/[caseTemplateId]/archive — soft-hide from resident bank.

import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { archiveCaseTemplate, CaseForgeError } from '@/server/services/cases/case-forge-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function POST(req: Request, ctx: { params: Promise<{ caseTemplateId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { caseTemplateId } = await ctx.params;

  try {
    await archiveCaseTemplate(caseTemplateId, auth.user.id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.CASE_TEMPLATE_ARCHIVED,
      entityType: 'CaseTemplate',
      entityId: caseTemplateId,
      summary: 'Case template archived',
      details: {},
      ...extractRequestMetadata(req),
    });
    return jsonOk({ archived: true });
  } catch (err) {
    if (err instanceof CaseForgeError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

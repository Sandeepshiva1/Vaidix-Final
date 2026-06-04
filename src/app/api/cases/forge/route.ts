// POST /api/cases/forge — turn a Document into a draft Socratic case.
// Body: { documentId, learnerLevel? }
// Returns: { caseTemplateId, title, condition }

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuthWithProgram,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { forgeCase, CaseForgeError } from '@/server/services/cases/case-forge-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const bodySchema = z.object({
  documentId: z.string().min(1),
  learnerLevel: z.string().trim().min(2).max(80).optional(),
});

export async function POST(req: Request) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const gate = await requireAuthWithProgram();
  if (!gate.ok) return gate.response;
  if (!FACULTY_LIKE.includes(gate.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const rl = await checkRateLimit({
    bucket: `case-forge:${gate.user.id}`,
    ...LIMITS.CASE_FORGE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Case forge throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  await audit({
    actorId: gate.user.id,
    actorRole: gate.user.role,
    eventType: AUDIT_EVENTS.CASE_FORGE_REQUESTED,
    entityType: 'Document',
    entityId: body.data.documentId,
    summary: 'Case forge requested',
    details: { documentId: body.data.documentId },
    ...extractRequestMetadata(req),
  });

  try {
    const outcome = await forgeCase({
      documentId: body.data.documentId,
      ownerId: gate.user.id,
      programId: gate.user.activeProgramId,
      learnerLevel: body.data.learnerLevel,
    });

    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.CASE_FORGE_COMPLETED,
      entityType: 'CaseTemplate',
      entityId: outcome.caseTemplateId,
      summary: `Forged case: ${outcome.condition}`,
      details: { documentId: body.data.documentId, title: outcome.title },
      ...extractRequestMetadata(req),
    });

    return jsonOk(outcome);
  } catch (err) {
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.CASE_FORGE_FAILED,
      entityType: 'Document',
      entityId: body.data.documentId,
      summary: 'Case forge failed',
      details: {
        documentId: body.data.documentId,
        error: err instanceof Error ? err.message.slice(0, 240) : 'unknown',
      },
      ...extractRequestMetadata(req),
    });
    if (err instanceof CaseForgeError) {
      const status =
        err.code === 'AI_UNAVAILABLE' ? 503 :
        err.code === 'AI_UNPARSEABLE' ? 502 :
        err.code === 'SOURCE_NOT_FOUND' ? 404 :
        err.code === 'SOURCE_TOO_LARGE' || err.code === 'EMPTY_OUTPUT' ? 400 : 500;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

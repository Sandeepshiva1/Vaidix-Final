// POST /api/documents/[id]/approve — faculty confirms classification (or overrides).
// Body: { route: DocumentRoute }

import { z } from 'zod';
import { DocumentRoute } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { updateClassification, DocumentAccessError } from '@/server/services/documents/document-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const approveSchema = z.object({
  route: z.nativeEnum(DocumentRoute),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, approveSchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;

  try {
    await updateClassification(
      { userId: auth.user.id, role: auth.user.role },
      id,
      body.data.route
    );
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_APPROVED,
      entityType: 'Document',
      entityId: id,
      summary: `Faculty set route=${body.data.route}`,
      details: { route: body.data.route },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ approved: true, route: body.data.route });
  } catch (err) {
    if (err instanceof DocumentAccessError) {
      const status = err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

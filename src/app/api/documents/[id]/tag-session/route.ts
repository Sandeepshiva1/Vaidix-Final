// POST /api/documents/[id]/tag-session — link a document to a teaching session.
// Body: { sessionId }

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { tagDocumentToSession, DocumentAccessError } from '@/server/services/documents/document-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const schema = z.object({
  sessionId: z.string().min(1),
  /** Admin/PD-only override to allow tagging a document the PHI scanner blocked.
   *  Server still re-checks the actor's role; clients passing this without
   *  authority will get FORBIDDEN. */
  phiOverride: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;

  try {
    await tagDocumentToSession(
      { userId: auth.user.id, role: auth.user.role },
      id,
      body.data.sessionId,
      { phiOverride: body.data.phiOverride === true }
    );
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_TAGGED_TO_SESSION,
      entityType: 'Document',
      entityId: id,
      summary: `Tagged to session ${body.data.sessionId}`,
      details: { sessionId: body.data.sessionId },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ linked: true });
  } catch (err) {
    if (err instanceof DocumentAccessError) {
      const status = err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// /api/documents/[id]
// ════════════════════════════════════════════════════════════════════════════
// GET: document detail + signed download URL.
// DELETE: soft-delete (manage permission required).

import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import {
  getDocumentForActor,
  softDeleteDocument,
  DocumentAccessError,
} from '@/server/services/documents/document-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

function statusFor(code: string): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    const doc = await getDocumentForActor(
      { userId: auth.user.id, role: auth.user.role },
      id,
      { withDownloadUrl: true }
    );
    return jsonOk({ document: doc });
  } catch (err) {
    if (err instanceof DocumentAccessError) return jsonError(err.code, err.message, statusFor(err.code));
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    await softDeleteDocument({ userId: auth.user.id, role: auth.user.role }, id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_DELETED,
      entityType: 'Document',
      entityId: id,
      summary: 'Document soft-deleted',
      ...extractRequestMetadata(req),
    });
    return jsonOk({ deleted: true });
  } catch (err) {
    if (err instanceof DocumentAccessError) return jsonError(err.code, err.message, statusFor(err.code));
    return handleUnexpected(err);
  }
}

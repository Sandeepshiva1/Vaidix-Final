// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/classroom/sessions/[id]/study-pack/documents/[linkId]
// ════════════════════════════════════════════════════════════════════════════
// Faculty / host removes a document from the pre-session study pack. The
// DocumentSessionLink row stays — only the `isPreSession` boolean flips back
// to false. The doc remains tagged to the session (post-session resources
// continue to surface it).

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  unassignDocumentFromStudyPack,
  StudyPackAccessError,
} from '@/server/services/study-pack/study-pack-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';

function statusFor(code: string): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId, linkId } = await ctx.params;
  try {
    await unassignDocumentFromStudyPack({
      sessionId,
      linkId,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.STUDY_PACK_DOC_REMOVED,
      entityType: 'DocumentSessionLink',
      entityId: linkId,
      summary: `Document removed from pre-session study pack`,
      details: { sessionId, linkId },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ removed: true });
  } catch (err) {
    if (err instanceof StudyPackAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/study-pack/documents — W6.8
// ════════════════════════════════════════════════════════════════════════════
// Faculty / host marks an existing session-tagged Document as pre-session.
// The document MUST already be linked to the session (via the W4 tag-session
// flow at /api/documents/[id]/tag-session) — this endpoint only flips the
// isPreSession boolean on the existing DocumentSessionLink row.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  assignDocumentToStudyPack,
  listStudyPackCandidates,
  StudyPackAccessError,
} from '@/server/services/study-pack/study-pack-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';

const schema = z.object({
  documentId: z.string().min(1),
  rank: z.number().int().nonnegative().optional(),
});

function statusFor(code: string): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  try {
    const items = await listStudyPackCandidates(sessionId, {
      userId: auth.user.id,
      role: auth.user.role,
    });
    return jsonOk({ sessionId, items });
  } catch (err) {
    if (err instanceof StudyPackAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;

  try {
    const result = await assignDocumentToStudyPack({
      sessionId,
      documentId: body.data.documentId,
      rank: body.data.rank,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.STUDY_PACK_DOC_ADDED,
      entityType: 'DocumentSessionLink',
      entityId: result.linkId,
      summary: `Document marked as pre-session study pack item`,
      details: { sessionId, documentId: body.data.documentId, rank: body.data.rank },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof StudyPackAccessError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

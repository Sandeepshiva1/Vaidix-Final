// POST /api/documents/[id]/classify — runs the AI classifier (Phase A heuristic).
// Stream C will swap heuristicClassify for a Gemini call before W4 ends.

import { db } from '@/lib/db';
import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import {
  applyAiClassification,
  enqueuePhiScan,
  heuristicClassify,
  DocumentAccessError,
} from '@/server/services/documents/document-service';
import { Role } from '@prisma/client';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { id } = await ctx.params;

  try {
    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, title: true, kind: true, mimeType: true },
    });
    if (!doc) return jsonError('NOT_FOUND', 'Document not found', 404);
    const classification = heuristicClassify({ title: doc.title, kind: doc.kind, mimeType: doc.mimeType });
    await applyAiClassification(id, classification);
    // The client calls /classify right after the presigned PUT completes — that's
    // the natural trigger point for the PHI scan. Idempotent jobId means
    // re-classifying doesn't duplicate work.
    await enqueuePhiScan(id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_CLASSIFIED,
      entityType: 'Document',
      entityId: id,
      summary: `AI classified as ${classification.suggestedRoute}`,
      details: { suggestedRoute: classification.suggestedRoute, confidence: classification.confidence },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ classification });
  } catch (err) {
    if (err instanceof DocumentAccessError) return jsonError(err.code, err.message, 400);
    return handleUnexpected(err);
  }
}

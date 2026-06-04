// POST /api/documents/[id]/phi-rescan — re-runs the PHI scanner on a document.
// Faculty-only. Useful when the file has been replaced via a signed PUT or
// when scanner rules have been updated.

import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { enqueuePhiScan } from '@/server/services/documents/document-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { id } = await ctx.params;

  const rl = await checkRateLimit({ bucket: `phi-rescan:${auth.user.id}`, ...LIMITS.DOCUMENT_ANALYZE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'PHI rescan throttled', 429, { resetAt: rl.resetAt.toISOString() });
  }

  try {
    const doc = await db.document.findUnique({ where: { id }, select: { id: true } });
    if (!doc) return jsonError('NOT_FOUND', 'Document not found', 404);
    const result = await enqueuePhiScan(id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_CLASSIFIED,
      entityType: 'Document',
      entityId: id,
      summary: 'PHI rescan enqueued',
      details: { jobId: result.jobId },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 202 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

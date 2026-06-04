// GET /api/promo/list?sessionId=... — Stream A9
// Returns generated promo assets for a session.

import { z } from 'zod';
import { db } from '@/lib/db';
import { Role, DocumentRoute } from '@prisma/client';
import { presignDownload } from '@/lib/storage';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseQuery,
  requireAuth,
} from '@/server/services/api-helpers';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const querySchema = z.object({
  sessionId: z.string().min(1),
});

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const q = await parseQuery(req, querySchema);
  if (!q.ok) return q.response;

  try {
    const docs = await db.document.findMany({
      where: {
        route: DocumentRoute.PROMO_ASSET,
        deletedAt: null,
        expungedAt: null,
        sessionLinks: { some: { sessionId: q.data.sessionId } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // bound the response; promo assets per session are few
      select: { id: true, title: true, s3Key: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
    const assets = await Promise.all(
      docs.map(async (d) => ({
        id: d.id,
        title: d.title,
        mimeType: d.mimeType,
        sizeBytes: Number(d.sizeBytes),
        downloadUrl: await presignDownload(d.s3Key, 6 * 3600),
        createdAt: d.createdAt.toISOString(),
      }))
    );
    return jsonOk({ assets });
  } catch (err) {
    return handleUnexpected(err);
  }
}

// POST /api/decks/[jobId]/reorder — supply { order: [slideId, slideId, ...] }
// to reorder all slides in one shot.

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { persistDeckAsDocument } from '@/server/services/decks/deck-pptx-renderer';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const Body = z.object({
  order: z.array(z.string().min(1)).min(1).max(60),
});

export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { jobId } = await ctx.params;
  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.response;

  try {
    const job = await db.deckForgeJob.findUnique({
      where: { id: jobId },
      select: {
        requestedById: true,
        slides: { select: { id: true } },
      },
    });
    if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
    if (
      job.requestedById !== auth.user.id &&
      auth.user.role !== Role.ADMIN &&
      auth.user.role !== Role.PROGRAM_DIRECTOR
    ) {
      return jsonError('FORBIDDEN', 'Not your deck', 403);
    }

    const have = new Set(job.slides.map((s) => s.id));
    const want = new Set(parsed.data.order);
    if (have.size !== want.size || parsed.data.order.some((id) => !have.has(id))) {
      return jsonError('VALIDATION_ERROR', 'order must list every slide id exactly once', 422);
    }

    // Two-phase: temporarily shift to negative orders to avoid the
    // (deckForgeJobId, order) unique-index colliding mid-update, then write
    // the final positions.
    await db.$transaction(async (tx) => {
      for (let i = 0; i < parsed.data.order.length; i++) {
        await tx.slide.update({
          where: { id: parsed.data.order[i] },
          data: { order: -1 - i },
        });
      }
      for (let i = 0; i < parsed.data.order.length; i++) {
        await tx.slide.update({
          where: { id: parsed.data.order[i] },
          data: { order: i },
        });
      }
    });

    // Refresh the library S3 copy in the background so the documents library
    // and any future exports reflect the new slide order immediately.
    void persistDeckAsDocument({ jobId }).catch(() => { /* best-effort */ })

    return jsonOk({ ok: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/decks/[jobId]/finalize — lock + present-ready
// ════════════════════════════════════════════════════════════════════════════
// Sets DeckForgeJob.status to APPROVED, snapshots reviewedById/reviewedAt for
// audit, and marks the deck ready to surface in any TeachingSession it's
// tagged to. Faculty can re-open the studio and keep editing; subsequent
// changes are de-facto revisions (we don't model revision history in v1 —
// the audit log captures who hit Finalize and when).

import { Role, DeckForgeStatus } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { persistDeckAsDocument } from '@/server/services/decks/deck-pptx-renderer';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Only faculty/PD/admin can finalize decks', 403);
  }

  const { jobId } = await ctx.params;

  try {
    const job = await db.deckForgeJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        requestedById: true,
        status: true,
        slideCount: true,
        inputTitle: true,
      },
    });
    if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);

    // Owner OR PD/admin can finalize.
    if (
      job.requestedById !== auth.user.id &&
      auth.user.role !== Role.ADMIN &&
      auth.user.role !== Role.PROGRAM_DIRECTOR
    ) {
      return jsonError('FORBIDDEN', 'Not your deck', 403);
    }

    if (job.status === DeckForgeStatus.REJECTED) {
      return jsonError('INVALID_STATE', 'Cannot finalize a discarded deck', 400);
    }

    // Refuse if there are no slides — faculty would be locking an empty deck.
    if (!job.slideCount || job.slideCount < 1) {
      return jsonError('INVALID_STATE', 'Cannot finalize a deck with no slides', 400);
    }

    await db.deckForgeJob.update({
      where: { id: jobId },
      data: {
        status: DeckForgeStatus.APPROVED,
        reviewedById: auth.user.id,
        reviewedAt: new Date(),
      },
    });

    // Refresh the saved Document copy to the finalized slide set. Best-effort.
    await persistDeckAsDocument({ jobId });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_FORGE_COMPLETED,
      entityType: 'DeckForgeJob',
      entityId: job.id,
      summary: `Deck finalized: ${job.inputTitle ?? 'Untitled'}`,
      details: { slideCount: job.slideCount },
      ...extractRequestMetadata(req),
    });

    return jsonOk({ ok: true, status: DeckForgeStatus.APPROVED });
  } catch (err) {
    return handleUnexpected(err);
  }
}

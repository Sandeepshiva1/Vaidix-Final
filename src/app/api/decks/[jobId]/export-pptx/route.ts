// POST /api/decks/[jobId]/export-pptx — server-renders Slide rows to a real
// .pptx binary and streams it as a download. Also overwrites the Document row
// in the faculty's library (created at forge time) so the saved copy stays in
// sync with the latest edits.
//
// All theme + layout code lives in deck-pptx-renderer so the on-screen export,
// auto-save on forge, and refresh on Finalize all emit identical .pptx output.

import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { db } from '@/lib/db';
import {
  renderDeckPptxBuffer,
  persistDeckAsDocument,
  DECK_PPTX_MIME,
} from '@/server/services/decks/deck-pptx-renderer';

export const runtime = 'nodejs';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId } = await ctx.params;

  try {
    const job = await db.deckForgeJob.findUnique({
      where: { id: jobId },
      select: { id: true, inputTitle: true, requestedById: true, slideCount: true },
    });
    if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
    if (
      job.requestedById !== auth.user.id &&
      auth.user.role !== Role.ADMIN &&
      auth.user.role !== Role.PROGRAM_DIRECTOR
    ) {
      return jsonError('FORBIDDEN', 'Not your deck', 403);
    }

    const rendered = await renderDeckPptxBuffer({ jobId, authorName: auth.user.name });
    if (!rendered) return jsonError('EMPTY_DECK', 'No slides to export', 422);

    // Refresh the library copy so the .pptx in /teacher/documents matches the
    // version the user just downloaded. Best-effort: a failure here must not
    // block the download response.
    await persistDeckAsDocument({ jobId });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_EXPORTED_PPTX,
      entityType: 'DeckForgeJob',
      entityId: jobId,
      summary: 'Deck exported as .pptx',
      details: { slideCount: rendered.slideCount },
      ...extractRequestMetadata(req),
    });

    const filename = `${(rendered.deckTitle || 'deck')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 60) || 'deck'}.pptx`;

    return new Response(new Uint8Array(rendered.buffer), {
      status: 200,
      headers: {
        'Content-Type': DECK_PPTX_MIME,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

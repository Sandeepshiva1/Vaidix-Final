// GET /api/decks/[jobId] — read a deck (job + slides) for the editor.
// PATCH /api/decks/[jobId] — update deck-level fields: template/theme and/or
//   backgroundHex (per-deck background colour override).
// DELETE /api/decks/[jobId] — soft-discard (status=REJECTED, slides remain for audit).

import { Role, DeckForgeStatus } from '@prisma/client';
import { THEME_IDS } from '@/lib/deck-themes';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

async function loadJobForActor(jobId: string, actorId: string, actorRole: Role) {
  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    include: {
      slides: { orderBy: { order: 'asc' } },
      document: { select: { id: true, title: true, kind: true } },
      recording: { select: { id: true, session: { select: { id: true, title: true } } } },
    },
  });
  if (!job) return null;
  // Owner OR program director / admin can read.
  if (
    job.requestedById !== actorId &&
    actorRole !== Role.ADMIN &&
    actorRole !== Role.PROGRAM_DIRECTOR
  ) {
    return 'forbidden' as const;
  }
  return job;
}

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { jobId } = await ctx.params;
  try {
    const job = await loadJobForActor(jobId, auth.user.id, auth.user.role);
    if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
    if (job === 'forbidden') return jsonError('FORBIDDEN', 'Not your deck', 403);
    return jsonOk({ deck: job });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { jobId } = await ctx.params;
  try {
    const body = (await req.json()) as { template?: string; backgroundHex?: string | null };
    const data: { template?: string; backgroundHex?: string | null } = {};

    if (body.template !== undefined) {
      if (!(THEME_IDS as string[]).includes(body.template)) {
        return jsonError('BAD_REQUEST', 'Invalid template value', 400);
      }
      data.template = body.template;
    }

    if (body.backgroundHex !== undefined) {
      // null or empty string resets to the theme default; otherwise require a
      // bare 6-digit hex (no '#') to match the stored format.
      if (body.backgroundHex === null || body.backgroundHex === '') {
        data.backgroundHex = null;
      } else if (/^[0-9a-fA-F]{6}$/.test(body.backgroundHex)) {
        data.backgroundHex = body.backgroundHex.toLowerCase();
      } else {
        return jsonError('BAD_REQUEST', 'backgroundHex must be a 6-digit hex colour (no #)', 400);
      }
    }

    if (Object.keys(data).length === 0) {
      return jsonError('BAD_REQUEST', 'Nothing to update', 400);
    }

    const job = await loadJobForActor(jobId, auth.user.id, auth.user.role);
    if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
    if (job === 'forbidden') return jsonError('FORBIDDEN', 'Not your deck', 403);
    await db.deckForgeJob.update({ where: { id: jobId }, data });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { jobId } = await ctx.params;
  try {
    const job = await loadJobForActor(jobId, auth.user.id, auth.user.role);
    if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
    if (job === 'forbidden') return jsonError('FORBIDDEN', 'Not your deck', 403);
    await db.deckForgeJob.update({
      where: { id: jobId },
      data: { status: DeckForgeStatus.REJECTED },
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

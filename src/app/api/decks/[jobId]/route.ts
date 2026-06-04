// GET /api/decks/[jobId] — read a deck (job + slides) for the editor.
// PATCH /api/decks/[jobId] — update deck-level fields (currently: template/theme).
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
    const body = (await req.json()) as { template?: string };
    if (!body.template || !(THEME_IDS as string[]).includes(body.template)) {
      return jsonError('BAD_REQUEST', 'Invalid template value', 400);
    }
    const job = await loadJobForActor(jobId, auth.user.id, auth.user.role);
    if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
    if (job === 'forbidden') return jsonError('FORBIDDEN', 'Not your deck', 403);
    await db.deckForgeJob.update({ where: { id: jobId }, data: { template: body.template } });
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

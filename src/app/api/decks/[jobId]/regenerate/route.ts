// POST /api/decks/[jobId]/regenerate — re-author an existing deck as a fully
// editable AI deck. Used by the editor's "Convert to editable" action on a
// VERBATIM import: it re-runs the formatted generation against the deck's
// original source and atomically replaces the flattened slides with editable
// ones (importMode → AI_GENERATED). Faculty-only, same ownership gate as the
// slide PATCH route. Destructive — the client confirms before calling.

import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { regenerateDeckEditable, DeckForgeError } from '@/server/services/decks/deck-forge-service';

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

  // Ownership gate — mirrors the slide PATCH / studio page guard exactly.
  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    select: { id: true, requestedById: true },
  });
  if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
  if (
    job.requestedById !== auth.user.id &&
    auth.user.role !== Role.ADMIN &&
    auth.user.role !== Role.PROGRAM_DIRECTOR
  ) {
    return jsonError('FORBIDDEN', 'Not your deck', 403);
  }

  const rl = await checkRateLimit({ bucket: `deck-forge:${auth.user.id}`, ...LIMITS.DECK_FORGE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Regenerate requests throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_FORGE_REQUESTED,
      entityType: 'DeckForgeJob',
      entityId: jobId,
      summary: 'Deck regenerate-as-editable requested',
      details: { jobId },
      ...extractRequestMetadata(req),
    });

    const result = await regenerateDeckEditable({ jobId, requestedById: auth.user.id });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_FORGE_COMPLETED,
      entityType: 'DeckForgeJob',
      entityId: jobId,
      summary: 'Deck regenerated as editable',
      details: { deckTitle: result.deckTitle, slideCount: result.slideCount },
      ...extractRequestMetadata(req),
    });

    return jsonOk(result);
  } catch (err) {
    if (err instanceof DeckForgeError) {
      await audit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        eventType: AUDIT_EVENTS.DECK_FORGE_FAILED,
        entityType: 'DeckForgeJob',
        entityId: jobId,
        summary: 'Deck regenerate-as-editable failed',
        details: { code: err.code, message: err.message },
        ...extractRequestMetadata(req),
      });
      const status =
        err.code === 'NO_SOURCE'
          ? 400
          : err.code === 'NOT_FOUND'
            ? 404
            : err.code === 'AI_UNAVAILABLE'
              ? 503
              : 500;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

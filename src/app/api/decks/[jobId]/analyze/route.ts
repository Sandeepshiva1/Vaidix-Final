// ════════════════════════════════════════════════════════════════════════════
// POST /api/decks/[jobId]/analyze — slide-aware two-pass analysis
// ════════════════════════════════════════════════════════════════════════════
// Triggers Opus (clinical review) + Sonnet (design) passes in parallel,
// persists structured suggestions to DeckForgeJob.analysisResult, returns
// the result for the AI Coach panel to render.

import { Role } from '@prisma/client';
import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  analyzeDeck,
  DeckAnalyzeError,
} from '@/server/services/decks/deck-analyze-service';
import { AiUnavailableError, AiUnparseableError } from '@/server/services/ai/router';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const bodySchema = z
  .object({
    /** When true, dismissed/applied state from prior runs is wiped. Default false. */
    resetState: z.boolean().optional(),
  })
  .default({});

export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Ownership check (mirrors GET /api/decks/[jobId]).
  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    select: { id: true, requestedById: true, slideCount: true },
  });
  if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
  if (
    job.requestedById !== auth.user.id &&
    auth.user.role !== Role.ADMIN &&
    auth.user.role !== Role.PROGRAM_DIRECTOR
  ) {
    return jsonError('FORBIDDEN', 'Not your deck', 403);
  }

  // Billable upstream (Opus + Sonnet) — fail-closed bucket.
  const rl = await checkRateLimit({ bucket: `deck-analyze:${auth.user.id}`, ...LIMITS.DECK_ANALYZE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Deck analysis runs throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await analyzeDeck({
      jobId,
      resetState: body.data.resetState ?? false,
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_ANALYZED,
      entityType: 'DeckForgeJob',
      entityId: jobId,
      summary: `Deck analyzed (${result.suggestions.length} suggestions)`,
      details: {
        readability: result.readabilityScore,
        density: result.slideDensityScore,
        balance: result.visualBalanceScore,
        passes: result.passes,
      },
      ...extractRequestMetadata(req),
    });

    return jsonOk({ analysis: result });
  } catch (err) {
    if (err instanceof DeckAnalyzeError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'EMPTY_DECK' ? 400 : 500;
      return jsonError(err.code, err.message, status);
    }
    if (err instanceof AiUnavailableError) {
      return jsonError('AI_UNAVAILABLE', err.message, 503);
    }
    if (err instanceof AiUnparseableError) {
      return jsonError('AI_UNPARSEABLE', err.message, 502);
    }
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/decks/[jobId]/slides/generate — AI-append new slides to a deck
// ════════════════════════════════════════════════════════════════════════════
// The in-editor "AI Slides" action. Generates 1–6 NEW slides from a faculty
// prompt and appends them to the existing deck (non-destructive). Mirrors the
// auth/CSRF/ownership/rate-limit/audit shape of analyze/route.ts.

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
  appendGeneratedSlides,
  DeckForgeError,
} from '@/server/services/decks/deck-forge-service';
import {
  GeminiUnavailableError,
  GeminiUnparseableError,
} from '@/server/services/ai/gemini';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const bodySchema = z.object({
  prompt: z.string().min(3).max(2000),
  count: z.number().int().min(1).max(6).optional(),
});

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

  // Ownership check (mirrors analyze + slides PATCH).
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

  // Billable upstream (Gemini) — reuse the deck-analyze fail-closed limit values
  // under a dedicated bucket so generation and analysis don't share a budget.
  const rl = await checkRateLimit({
    bucket: `deck-slide-generate:${auth.user.id}`,
    ...LIMITS.DECK_ANALYZE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Slide generation throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const { slides } = await appendGeneratedSlides({
      jobId,
      prompt: body.data.prompt,
      count: body.data.count,
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_SLIDES_GENERATED,
      entityType: 'DeckForgeJob',
      entityId: jobId,
      summary: `AI-generated ${slides.length} slide(s)`,
      details: { count: slides.length, slideIds: slides.map((s) => s.id) },
      ...extractRequestMetadata(req),
    });

    return jsonOk({ slides });
  } catch (err) {
    if (err instanceof DeckForgeError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'EMPTY_DECK' ? 400 : 500;
      return jsonError(err.code, err.message, status);
    }
    if (err instanceof GeminiUnavailableError) {
      return jsonError('AI_UNAVAILABLE', err.message, 503);
    }
    if (err instanceof GeminiUnparseableError) {
      return jsonError('AI_UNPARSEABLE', err.message, 502);
    }
    return handleUnexpected(err);
  }
}

// POST /api/decks/forge — generate a slide deck from an uploaded document
// and/or a recording transcript. Faculty-only. synchronous Gemini.

import { z } from 'zod';
import { Role, DeckForgeStatus } from '@prisma/client';
import { db } from '@/lib/db';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { forgeDeck, DeckForgeError } from '@/server/services/decks/deck-forge-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const ForgeBody = z
  .object({
    documentId: z.string().min(1).optional(),
    recordingId: z.string().min(1).optional(),
    /**
     * Topic-only path: generate a deck from a typed topic prompt with no
     * uploaded document and no recording.
     */
    topic: z.string().trim().min(6).max(300).optional(),
    inputTitle: z.string().min(1).max(120).optional(),
    learnerLevel: z.string().min(1).max(80).optional(),
    /**
     * When true, bypass the same-source dedupe and force a fresh forge even
     * if a usable job already exists for this document/recording. Faculty
     * triggers this via the explicit "Re-forge" link on the doc card.
     */
    force: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.documentId || v.recordingId || v.topic), {
    message: 'documentId, recordingId, or topic must be provided',
  });

export async function POST(req: Request) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }

  const parsed = await parseBody(req, ForgeBody);
  if (!parsed.ok) return parsed.response;

  // Dedupe guard: if a usable (non-FAILED, non-REJECTED) job already exists
  // for the same source + requester, return it instead of paying for another
  // Gemini call. Faculty can force a fresh forge with `force: true`. Without
  // this, every re-click of the doc-card "Forge slides" button (or a stale
  // browser tab) spawns a duplicate deck and burns provider credit.
  if (!parsed.data.force && (parsed.data.documentId || parsed.data.recordingId)) {
    const existing = await db.deckForgeJob.findFirst({
      where: {
        requestedById: auth.user.id,
        status: { notIn: [DeckForgeStatus.FAILED, DeckForgeStatus.REJECTED] },
        ...(parsed.data.documentId ? { documentId: parsed.data.documentId } : {}),
        ...(parsed.data.recordingId ? { recordingId: parsed.data.recordingId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, inputTitle: true, slideCount: true, status: true },
    });
    if (existing) {
      return jsonOk({
        jobId: existing.id,
        deckTitle: existing.inputTitle ?? 'Forged Deck',
        slideCount: existing.slideCount ?? 0,
        reused: true,
        status: existing.status,
      });
    }
  }

  const rl = await checkRateLimit({ bucket: `deck-forge:${auth.user.id}`, ...LIMITS.DECK_FORGE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Forge requests throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_FORGE_REQUESTED,
      entityType: 'DeckForgeJob',
      entityId: 'pending',
      summary: 'Deck forge requested',
      details: {
        documentId: parsed.data.documentId ?? null,
        recordingId: parsed.data.recordingId ?? null,
        topic: parsed.data.topic ?? null,
      },
      ...extractRequestMetadata(req),
    });

    const result = await forgeDeck({
      documentId: parsed.data.documentId ?? null,
      recordingId: parsed.data.recordingId ?? null,
      topic: parsed.data.topic ?? null,
      inputTitle: parsed.data.inputTitle,
      learnerLevel: parsed.data.learnerLevel,
      requestedById: auth.user.id,
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_FORGE_COMPLETED,
      entityType: 'DeckForgeJob',
      entityId: result.jobId,
      summary: 'Deck forge completed',
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
        entityId: 'failed',
        summary: 'Deck forge failed',
        details: { code: err.code, message: err.message },
        ...extractRequestMetadata(req),
      });
      const status =
        err.code === 'NO_SOURCE'
          ? 400
          : err.code === 'SOURCE_NOT_FOUND'
            ? 404
            : err.code === 'AI_UNAVAILABLE'
              ? 503
              : 500;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

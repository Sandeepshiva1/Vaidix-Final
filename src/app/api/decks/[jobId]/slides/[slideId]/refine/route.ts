// POST /api/decks/[jobId]/slides/[slideId]/refine
// Per-slide chat-style AI rewrite. Body: { instruction, intent }
// Returns a *proposal* (before/after). Faculty PATCHes the slide to commit.

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
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  refineSlideWithInstruction,
  DeckRefineError,
} from '@/server/services/decks/deck-refine-service';
import { recordEditSignal } from '@/server/services/decks/faculty-style-profile';
import { FacultyEditSignalKind } from '@prisma/client';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

/** Mirrors deriveTopicTag in slides/[slideId]/route.ts — kept inline rather
 *  than extracted because each call site has slightly different selects and
 *  inlining keeps the hot path tight. Same rule: first content word of the
 *  deck title, lowercased, length > 2. */
function deriveTopicTag(inputTitle: string | null | undefined): string | null {
  if (!inputTitle) return null;
  const cleaned = inputTitle.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
  const first = cleaned.split(/\s+/)[0];
  return first && first.length > 2 ? first : null;
}

const bodySchema = z.object({
  instruction: z.string().trim().min(2).max(500),
  intent: z.enum(['english', 'content']),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ jobId: string; slideId: string }> },
) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId, slideId } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    select: { requestedById: true, inputTitle: true, briefing: true },
  });
  if (!job) return jsonError('NOT_FOUND', 'Deck not found', 404);
  if (
    job.requestedById !== auth.user.id &&
    auth.user.role !== Role.ADMIN &&
    auth.user.role !== Role.PROGRAM_DIRECTOR
  ) {
    return jsonError('FORBIDDEN', 'Not your deck', 403);
  }

  const rl = await checkRateLimit({
    bucket: `deck-refine:${auth.user.id}`,
    ...LIMITS.DECK_REFINE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Refine throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const proposal = await refineSlideWithInstruction({
      jobId,
      slideId,
      instruction: body.data.instruction,
      intent: body.data.intent,
    });

    // Capture the instruction as a style signal — only when the refiner is
    // the deck owner. Refines on someone else's deck (admin/PD) do NOT
    // pollute either user's profile.
    if (job.requestedById === auth.user.id) {
      const briefing = (job.briefing ?? null) as
        | { audience?: string; sessionType?: string }
        | null;
      void recordEditSignal({
        facultyId: auth.user.id,
        kind: FacultyEditSignalKind.REFINE_INSTRUCTION,
        topicTag: deriveTopicTag(job.inputTitle),
        audienceTag: briefing?.audience ?? null,
        sessionType: briefing?.sessionType ?? null,
        jobId,
        slideId,
        instructionText: body.data.instruction,
        beforeJson: proposal.before,
        afterJson: proposal.after,
      }).catch((err) => {
        console.warn('[style-profile] capture failed (non-fatal):', err);
      });
    }

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_SLIDE_REFINED,
      entityType: 'Slide',
      entityId: slideId,
      summary: `Refined slide via ${body.data.intent}`,
      // `intent` (english | content) is recorded as the routing signal.
      // The actual model tier is intentionally NOT stored in audit details —
      // it would let anyone with audit-read access reverse the routing map.
      details: { jobId, intent: body.data.intent },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ proposal });
  } catch (err) {
    if (err instanceof DeckRefineError) {
      const status =
        err.code === 'AI_UNAVAILABLE' ? 503 :
        err.code === 'AI_UNPARSEABLE' ? 502 :
        err.code === 'NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

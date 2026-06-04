// POST /api/decks/[jobId]/suggestions/[suggestionId]/apply
// Returns a *proposal* (before/after diff) — does NOT mutate the slide.
// The UI shows the diff; faculty clicks Accept which calls
// PATCH /api/decks/[jobId]/slides/[slideId] with the proposed body and
// then POST /api/decks/[jobId]/suggestions/[suggestionId]/apply?commit=true
// to mark the suggestion applied. This preserves faculty veto.

import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  isRouterV2,
  markSuggestionApplied,
  DeckAnalyzeError,
} from '@/server/services/decks/deck-analyze-service';
import {
  applySuggestionToSlide,
  DeckRefineError,
} from '@/server/services/decks/deck-refine-service';
import { recordEditSignal } from '@/server/services/decks/faculty-style-profile';
import { FacultyEditSignalKind } from '@prisma/client';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

function deriveTopicTag(inputTitle: string | null | undefined): string | null {
  if (!inputTitle) return null;
  const cleaned = inputTitle.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
  const first = cleaned.split(/\s+/)[0];
  return first && first.length > 2 ? first : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ jobId: string; suggestionId: string }> },
) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId, suggestionId } = await ctx.params;
  const url = new URL(req.url);
  const commit = url.searchParams.get('commit') === 'true';

  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    select: {
      requestedById: true,
      analysisResult: true,
      inputTitle: true,
      briefing: true,
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
  if (!isRouterV2(job.analysisResult)) {
    return jsonError('NO_ANALYSIS', 'Run deck analyze first', 400);
  }
  const suggestion = job.analysisResult.suggestions.find((s) => s.id === suggestionId);
  if (!suggestion) return jsonError('SUGGESTION_NOT_FOUND', 'Suggestion not found', 404);

  // Commit branch — caller already accepted the diff and PATCHed the slide.
  if (commit) {
    try {
      const result = await markSuggestionApplied(jobId, suggestionId);

      // Capture accept signal — only when the actor is the deck owner.
      if (job.requestedById === auth.user.id) {
        const briefing = (job.briefing ?? null) as
          | { audience?: string; sessionType?: string }
          | null;
        void recordEditSignal({
          facultyId: auth.user.id,
          kind: FacultyEditSignalKind.SUGGESTION_ACCEPTED,
          topicTag: deriveTopicTag(job.inputTitle),
          audienceTag: briefing?.audience ?? null,
          sessionType: briefing?.sessionType ?? null,
          jobId,
          slideId: suggestion.slideId ?? null,
          instructionText: suggestion.message ?? null,
          beforeJson: { kind: suggestion.kind, severity: suggestion.severity },
          afterJson: null,
        }).catch((err) => {
          console.warn('[style-profile] capture failed (non-fatal):', err);
        });
      }

      await audit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        eventType: AUDIT_EVENTS.DECK_SUGGESTION_APPLIED,
        entityType: 'DeckForgeJob',
        entityId: jobId,
        summary: `Applied suggestion ${suggestionId}`,
        details: { suggestionId, kind: suggestion.kind },
        ...extractRequestMetadata(req),
      });
      return jsonOk({ analysis: result });
    } catch (err) {
      if (err instanceof DeckAnalyzeError) {
        return jsonError(err.code, err.message, 400);
      }
      return handleUnexpected(err);
    }
  }

  // Proposal branch — generate the rewrite and return the diff. Counts
  // against DECK_REFINE bucket because each call hits an LLM.
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
    const proposal = await applySuggestionToSlide({ jobId, suggestion });
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

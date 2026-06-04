// POST /api/decks/[jobId]/suggestions/[suggestionId]/dismiss
// Marks one DeckSuggestion as dismissed. Carry-forward in analyzeDeck() keeps
// it dismissed across re-analyses so faculty isn't re-pestered.

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
import { dismissSuggestion, DeckAnalyzeError, isRouterV2 } from '@/server/services/decks/deck-analyze-service';
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

  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    select: {
      requestedById: true,
      inputTitle: true,
      briefing: true,
      analysisResult: true,
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

  try {
    const result = await dismissSuggestion(jobId, suggestionId);

    // Capture the dismiss signal — only when the actor is the deck owner.
    // We pull the suggestion's metadata out of the analysisResult snapshot
    // we already read above. If the analysisResult shape doesn't match the
    // expected router-v2 shape (legacy decks), skip silently.
    if (job.requestedById === auth.user.id && isRouterV2(job.analysisResult)) {
      const suggestion = job.analysisResult.suggestions.find((s) => s.id === suggestionId);
      if (suggestion) {
        const briefing = (job.briefing ?? null) as
          | { audience?: string; sessionType?: string }
          | null;
        void recordEditSignal({
          facultyId: auth.user.id,
          kind: FacultyEditSignalKind.SUGGESTION_DISMISSED,
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
    }

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_SUGGESTION_DISMISSED,
      entityType: 'DeckForgeJob',
      entityId: jobId,
      summary: `Dismissed suggestion ${suggestionId}`,
      details: { suggestionId },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ analysis: result });
  } catch (err) {
    if (err instanceof DeckAnalyzeError) {
      const status =
        err.code === 'NOT_FOUND' || err.code === 'SUGGESTION_NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

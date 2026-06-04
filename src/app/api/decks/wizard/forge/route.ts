// ════════════════════════════════════════════════════════════════════════════
// POST /api/decks/wizard/forge — multi-input forge with intent + briefing
// ════════════════════════════════════════════════════════════════════════════
// Wired to the new wizard at /teacher/decks/new. Distinct from the legacy
// single-source /api/decks/forge — that route stays alive for the
// document-detail "Forge presentation" quick-start (no briefing, no intent
// gate). Both routes write into the same DeckForgeJob table.
//
// Phase 1A wizard intake — Codex review checkpoint.

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
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  wizardForgeDeck,
  WizardForgeError,
} from '@/server/services/decks/wizard-forge-service';
import { DeckForgeIntent, DeckForgeInputRole } from '@prisma/client';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const BriefingSchema = z.object({
  audience: z.string().min(1).max(120),
  sessionType: z.enum(['LECTURE', 'CASE_CONFERENCE', 'JOURNAL_CLUB', 'TUTORIAL']),
  durationMin: z.number().int().min(10).max(240),
  objectives: z.string().min(1).max(1000),
  localContext: z.string().max(2000).optional(),
});

const InputDocSchema = z.object({
  documentId: z.string().min(1),
  role: z.nativeEnum(DeckForgeInputRole),
});

const WizardForgeBody = z.object({
  intent: z.nativeEnum(DeckForgeIntent),
  briefing: BriefingSchema,
  inputs: z.array(InputDocSchema).min(1).max(8),
  inputTitle: z.string().min(1).max(120).optional(),
});

function statusForCode(code: WizardForgeError['code']): number {
  switch (code) {
    case 'VALIDATION':
      return 400;
    case 'SOURCE_NOT_FOUND':
      return 404;
    case 'SOURCE_TOO_LARGE':
      return 413;
    case 'AI_UNAVAILABLE':
      return 503;
    case 'EMPTY_DECK':
    case 'FORGE_FAILED':
    default:
      return 500;
  }
}

export async function POST(req: Request) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Only faculty/PD/admin can forge decks', 403);
  }

  const parsed = await parseBody(req, WizardForgeBody);
  if (!parsed.ok) return parsed.response;

  const rl = await checkRateLimit({
    bucket: `deck-wizard-forge:${auth.user.id}`,
    ...LIMITS.DECK_WIZARD_FORGE,
  });
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
      summary: `Wizard forge requested (${parsed.data.intent})`,
      details: {
        intent: parsed.data.intent,
        sessionType: parsed.data.briefing.sessionType,
        durationMin: parsed.data.briefing.durationMin,
        inputCount: parsed.data.inputs.length,
      },
      ...extractRequestMetadata(req),
    });

    const result = await wizardForgeDeck({
      intent: parsed.data.intent,
      briefing: parsed.data.briefing,
      inputs: parsed.data.inputs,
      inputTitle: parsed.data.inputTitle,
      requestedById: auth.user.id,
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_FORGE_COMPLETED,
      entityType: 'DeckForgeJob',
      entityId: result.jobId,
      summary: 'Wizard forge completed',
      details: { deckTitle: result.deckTitle, slideCount: result.slideCount },
      ...extractRequestMetadata(req),
    });

    return jsonOk(result);
  } catch (err) {
    if (err instanceof WizardForgeError) {
      await audit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        eventType: AUDIT_EVENTS.DECK_FORGE_FAILED,
        entityType: 'DeckForgeJob',
        entityId: 'failed',
        summary: 'Wizard forge failed',
        details: { code: err.code, message: err.message },
        ...extractRequestMetadata(req),
      });
      return jsonError(err.code, err.message, statusForCode(err.code));
    }
    return handleUnexpected(err);
  }
}

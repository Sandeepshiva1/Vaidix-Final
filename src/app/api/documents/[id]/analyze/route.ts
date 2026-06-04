// POST /api/documents/[id]/analyze — Smart Presentation Enhancement Studio (Stream C #15).
// Phase A: heuristic-only analysis (page count, mime check, title heuristics).
// Phase B: swap with Gemini-vision pass over slide images for real density/balance scoring.

import { db } from '@/lib/db';
import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { Role, DeckForgeStatus, DocumentKind } from '@prisma/client';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { env } from '@/lib/env';
import { geminiGenerate, GeminiUnavailableError, GeminiUnparseableError, tryParseJson } from '@/server/services/ai/gemini';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

interface SlideSuggestion {
  slideIdx: number;
  kind: 'TEXT_OVERLOAD' | 'INTERACTION_POINT' | 'VISUAL_BALANCE' | 'READABILITY';
  message: string;
}

interface AnalysisResult {
  readabilityScore: number; // 0–10
  slideDensityScore: number; // 0–10 (10 = best, low density)
  visualBalanceScore: number; // 0–10
  suggestions: SlideSuggestion[];
  notes: string;
  /** Client-facing label. 'ai' = upstream AI analysis; 'heuristic' = rules-only fallback. We deliberately do not name the provider here. */
  source: 'ai' | 'heuristic';
}

const PRESENTATION_SYSTEM_PROMPT = `You are a presentation design coach for medical educators at LV Prasad Eye Institute.
You evaluate the metadata of an uploaded teaching deck and produce structured feedback.

You MUST output strict JSON matching this TypeScript interface:
{
  "readabilityScore": number,        // 0-10, 10 = excellent for a 1-hour live lecture
  "slideDensityScore": number,       // 0-10, 10 = ideal density (not too sparse, not too dense)
  "visualBalanceScore": number,      // 0-10, 10 = ideal mix of text, images, whitespace
  "suggestions": [
    {
      "slideIdx": number,            // 1-based; -1 = applies to whole deck
      "kind": "TEXT_OVERLOAD" | "INTERACTION_POINT" | "VISUAL_BALANCE" | "READABILITY",
      "message": string              // <= 140 chars, actionable
    }
  ],
  "notes": string                    // 1-2 sentence summary
}

Rules:
- Be strict. Most decks should land 5-7 across the three scores; >8 only for genuinely excellent.
- Suggest interaction points (polls, T/F, dilemmas) every 6-8 slides for engagement.
- If slide count is high (>40 for a 1-hour session), call it out as TEXT_OVERLOAD with slideIdx=-1.
- Output JSON only — no prose, no markdown fences.`;

async function geminiAnalyze(doc: {
  title: string;
  description: string | null;
  kind: DocumentKind;
  pageCount: number | null;
}): Promise<AnalysisResult> {
  const userPrompt = `Analyse this teaching deck.

Title: ${doc.title}
Kind: ${doc.kind}
Slide count: ${doc.pageCount ?? 'unknown'}
Description: ${doc.description ?? '(none)'}
Target session length: 60 minutes
Audience: ophthalmology residents at LVPEI

Return strict JSON only.`;
  const text = await geminiGenerate({
    systemInstruction: PRESENTATION_SYSTEM_PROMPT,
    userParts: [{ text: userPrompt }],
    responseMimeType: 'application/json',
    temperature: 0.2,
  });
  const parsed = tryParseJson<{
    readabilityScore?: number;
    slideDensityScore?: number;
    visualBalanceScore?: number;
    suggestions?: SlideSuggestion[];
    notes?: string;
  }>(text);

  const clamp = (n: number | undefined, def: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : def;

  return {
    readabilityScore: clamp(parsed.readabilityScore, 6),
    slideDensityScore: clamp(parsed.slideDensityScore, 6),
    visualBalanceScore: clamp(parsed.visualBalanceScore, 6),
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .filter((s) => s && typeof s.message === 'string')
          .slice(0, 20)
          .map((s) => ({
            slideIdx: typeof s.slideIdx === 'number' ? s.slideIdx : -1,
            kind:
              s.kind === 'TEXT_OVERLOAD' || s.kind === 'INTERACTION_POINT' || s.kind === 'VISUAL_BALANCE' || s.kind === 'READABILITY'
                ? s.kind
                : 'READABILITY',
            message: String(s.message).slice(0, 200),
          }))
      : [],
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 500) : 'AI analysis returned no notes.',
    source: 'ai',
  };
}

function heuristicAnalyze(doc: { title: string; kind: DocumentKind; pageCount: number | null }): AnalysisResult {
  // Phase A heuristic: rough scoring derived from page count vs typical lecture density.
  const slides = doc.pageCount ?? 25;
  const density = slides > 60 ? 4 : slides > 40 ? 6 : slides > 25 ? 8 : 7;
  const readability = doc.kind === DocumentKind.PPT ? 7 : 6;
  const balance = 7;

  const suggestions: SlideSuggestion[] = [];
  if (slides > 40) {
    suggestions.push({
      slideIdx: -1,
      kind: 'TEXT_OVERLOAD',
      message: `Deck has ${slides} slides — consider trimming to <40 for a 1-hour session.`,
    });
  }
  // Suggest interaction points every ~7 slides.
  for (let i = 7; i < slides; i += 7) {
    suggestions.push({
      slideIdx: i,
      kind: 'INTERACTION_POINT',
      message: `Insert a poll, T/F, or quick quiz around slide ${i} to maintain engagement.`,
    });
  }

  return {
    readabilityScore: readability,
    slideDensityScore: density,
    visualBalanceScore: balance,
    suggestions,
    notes:
      'Heuristic analysis (AI assistant unavailable). Falls back to rules-only scoring of slide count and density.',
    source: 'heuristic',
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { id } = await ctx.params;

  const rl = await checkRateLimit({ bucket: `doc-analyze:${auth.user.id}`, ...LIMITS.DOCUMENT_ANALYZE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Analysis runs throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, title: true, description: true, kind: true, pageCount: true, uploadedById: true },
    });
    if (!doc) return jsonError('NOT_FOUND', 'Document not found', 404);

    let result: AnalysisResult;
    if (env.GEMINI_API_KEY) {
      try {
        result = await geminiAnalyze(doc);
      } catch (err) {
        if (err instanceof GeminiUnavailableError || err instanceof GeminiUnparseableError) {
          console.warn('[doc-analyze] AI analysis failed, falling back to heuristic:', err);
          result = heuristicAnalyze(doc);
        } else {
          throw err;
        }
      }
    } else {
      result = heuristicAnalyze(doc);
    }

    // Persist to a DeckForgeJob row (re-uses the existing model + W4 analysisResult column).
    const job = await db.deckForgeJob.create({
      data: {
        documentId: doc.id,
        requestedById: auth.user.id,
        status: DeckForgeStatus.QUEUED,
        analysisResult: result as unknown as object,
        slideCount: doc.pageCount,
      },
      select: { id: true, status: true },
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_ANALYZED,
      entityType: 'DeckForgeJob',
      entityId: job.id,
      summary: 'Smart Presentation analysis run',
      details: {
        documentId: doc.id,
        readabilityScore: result.readabilityScore,
        slideDensityScore: result.slideDensityScore,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ analysis: result, jobId: job.id });
  } catch (err) {
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Quiz Questions Service — Prepare Learners "Knowledge Priming Quiz"
// ════════════════════════════════════════════════════════════════════════════
// Generates priming quiz questions (MCQs + open-ended) for a teaching session
// FROM the faculty's uploaded preread material. Grounding mirrors the study-
// artifacts service: session title, objectives, subspecialty, and the TITLES of
// linked preread documents. We deliberately do NOT parse uploaded file bytes —
// this is a fast prep helper, not a full ingestion pipeline.
//
// Generation is GATED on material: questions can only be generated when at least
// one (non-deleted) preread document is linked to the session. With no material
// the service throws `QuizMaterialError('NO_MATERIAL', …)` so the route can
// surface a clean 422 and the client can keep the button disabled.
//
// Gemini is the AI provider (same wrapper used everywhere else). When the model
// is unreachable / unconfigured, `GeminiUnavailableError` propagates so the
// route can return an honest 503 instead of fabricating content.

import { db } from '@/lib/db';
import { geminiGenerate, tryParseJson } from '@/server/services/ai/gemini';

export interface QuizQuestions {
  mcqs: Array<{ q: string; options: string[]; correct: number }>;
  openEnded: Array<{ q: string }>;
}

/** Thrown when generation is requested but the session has no preread material. */
export class QuizMaterialError extends Error {
  constructor(
    public readonly code: 'NO_MATERIAL',
    message: string,
  ) {
    super(message);
    this.name = 'QuizMaterialError';
  }
}

const SYSTEM_PROMPT = `You are an ophthalmology medical educator at LV Prasad Eye Institute writing a
pre-session "knowledge priming" quiz for residents. You produce questions for ONE
clinical teaching topic, grounded only in the session context you are given
(title, objectives, subspecialty, and the TITLES of the faculty's uploaded
preread material).

OUTPUT — strict JSON, no prose, no markdown fences:
{
  "mcqs":      [{ "q": string, "options": [string, string, string, string], "correct": number }],
  "openEnded": [{ "q": string }]
}

QUANTITY
- mcqs: about 5 items.
- openEnded: about 2 items.

RULES
- MCQs: "q" is a crisp single-best-answer clinical/recall question. "options" has
  EXACTLY 4 distinct plausible choices. "correct" is the 0-based index (0-3) of the
  single correct option. Avoid "all/none of the above".
- Open-ended: "q" is a short reasoning prompt a resident answers in 1-3 sentences.
- Ground every question in the preread material titles and the session objectives —
  prefer concepts the residents are expected to have studied beforehand.
- Evidence-minded: anchor to standard ophthalmology teaching (e.g. AAO PPP, ETDRS,
  Shaffer/Spaeth). Do NOT invent drug doses, drug names, or numeric classification
  cutoffs you are not certain of. Prefer concepts over precise numbers.
- Ophthalmology vocabulary throughout (slit-lamp, fundoscopy, OCT, FFA, gonioscopy,
  etc.). No generic filler.`;

interface RawQuiz {
  mcqs?: unknown;
  openEnded?: unknown;
}

function asString(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function normalize(parsed: RawQuiz): QuizQuestions {
  const mcqs = (Array.isArray(parsed.mcqs) ? parsed.mcqs : [])
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const options = (Array.isArray(o.options) ? o.options : [])
        .map((opt) => asString(opt, 240))
        .filter((opt) => opt.length > 0)
        .slice(0, 6);
      const rawCorrect = typeof o.correct === 'number' ? Math.trunc(o.correct) : 0;
      // Clamp the correct index into range; default to 0 when out of bounds.
      const correct = rawCorrect >= 0 && rawCorrect < options.length ? rawCorrect : 0;
      return { q: asString(o.q, 2000), options, correct };
    })
    .filter((m) => m.q.length > 0 && m.options.length >= 2)
    .slice(0, 10);

  const openEnded = (Array.isArray(parsed.openEnded) ? parsed.openEnded : [])
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { q: asString(o.q, 2000) };
    })
    .filter((e) => e.q.length > 0)
    .slice(0, 10);

  return { mcqs, openEnded };
}

interface ObjectiveLike {
  text?: unknown;
}

function readObjectives(objectives: unknown): string[] {
  if (!Array.isArray(objectives)) return [];
  return objectives
    .map((o) => (o && typeof o === 'object' ? asString((o as ObjectiveLike).text, 240) : ''))
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

/**
 * Generate priming quiz questions for a session from its preread material.
 *
 * Throws:
 *   - `QuizMaterialError('NO_MATERIAL')` when no preread document is linked.
 *   - `GeminiUnavailableError` when the AI provider is unreachable/unconfigured
 *     (lets the caller return a clean 503 — never returns fabricated content).
 */
export async function generateQuizQuestions({
  sessionId,
}: {
  sessionId: string;
}): Promise<QuizQuestions> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      title: true,
      description: true,
      objectives: true,
      tags: true,
      topicId: true,
    },
  });
  if (!session) {
    throw new Error('Session not found');
  }

  const [topic, links] = await Promise.all([
    session.topicId
      ? db.topic.findUnique({
          where: { id: session.topicId },
          select: { name: true, subspecialty: true },
        })
      : Promise.resolve(null),
    db.documentSessionLink.findMany({
      where: { sessionId, document: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: { document: { select: { title: true } } },
      take: 20,
    }),
  ]);

  const docTitles = links.map((l) => l.document.title).filter(Boolean);
  // Gate: no material → no generation. The route maps this to a 422 and the
  // client keeps the button disabled, so this is a defense-in-depth guard.
  if (docTitles.length === 0) {
    throw new QuizMaterialError(
      'NO_MATERIAL',
      'Upload preread material before generating quiz questions.',
    );
  }

  const objectives = readObjectives(session.objectives);
  const subspecialty = topic?.subspecialty ?? session.tags?.[0] ?? 'Ophthalmology';

  const contextLines: string[] = [
    `Session title: ${session.title}`,
    `Subspecialty: ${subspecialty}`,
  ];
  if (topic?.name) contextLines.push(`Curriculum topic: ${topic.name}`);
  if (session.description) {
    contextLines.push(`Session description: ${asString(session.description, 600)}`);
  }
  if (objectives.length) {
    contextLines.push('Learning objectives:');
    for (const o of objectives) contextLines.push(`- ${o}`);
  }
  contextLines.push('Preread material titles (file contents are NOT provided — ground on these):');
  for (const t of docTitles) contextLines.push(`- ${t}`);
  contextLines.push(
    'Produce the priming-quiz JSON now for this topic, grounded in the material above.',
  );

  const raw = await geminiGenerate({
    systemInstruction: SYSTEM_PROMPT,
    userParts: [{ text: contextLines.join('\n') }],
    responseMimeType: 'application/json',
    temperature: 0.4,
  });

  return normalize(tryParseJson<RawQuiz>(raw));
}

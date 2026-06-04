// ════════════════════════════════════════════════════════════════════════════
// Study Artifacts Service — Prepare Learners "Mind Maps"
// ════════════════════════════════════════════════════════════════════════════
// Generates lightweight learner study artifacts (flashcards / microlearning /
// infographics) for a teaching session's clinical topic. Grounding is metadata
// only — session title, learning objectives, subspecialty, and the TITLES of
// linked preread documents. We deliberately do NOT parse uploaded file bytes:
// this is a fast, cheap prep helper, not a full deck forge.
//
// Gemini is the AI provider in Phase A (same wrapper used everywhere else).
// When the model is unreachable / unconfigured, `GeminiUnavailableError`
// propagates so the route can surface an honest 503 instead of fabricating
// content.

import { db } from '@/lib/db';
import { geminiGenerate, tryParseJson } from '@/server/services/ai/gemini';

export interface StudyArtifacts {
  flashcards: Array<{ q: string; a: string }>;
  microlearning: Array<{ title: string; dur: string; kind: 'video' | 'reading' | 'flash' }>;
  infographics: Array<{ title: string; sub: string }>;
}

const SYSTEM_PROMPT = `You are an ophthalmology medical educator at LV Prasad Eye Institute building
pre-session self-study artifacts for residents. You produce a compact set of
study aids for ONE clinical teaching topic, grounded only in the session context
you are given (title, objectives, subspecialty, and linked preread titles).

OUTPUT — strict JSON, no prose, no markdown fences:
{
  "flashcards":    [{ "q": string, "a": string }],
  "microlearning": [{ "title": string, "dur": string, "kind": "video" | "reading" | "flash" }],
  "infographics":  [{ "title": string, "sub": string }]
}

QUANTITY
- flashcards: about 6 items.
- microlearning: exactly 3 items.
- infographics: exactly 3 items.

RULES
- Flashcards: "q" is a crisp recall/clinical-reasoning prompt; "a" is a tight,
  correct answer (<= 240 chars). Cover diagnosis, classification, and management
  for the topic.
- Microlearning: "title" names a short self-study activity; "dur" is a human
  duration like "5 min"; "kind" is one of video | reading | flash.
- Infographics: "title" is what a one-screen visual would teach; "sub" is a
  one-line caption (<= 120 chars).
- Evidence-minded: anchor to standard ophthalmology teaching (e.g. AAO PPP,
  ETDRS, Shaffer/Spaeth). Do NOT invent drug doses, drug names, or numeric
  classification cutoffs you are not certain of. Prefer concepts over numbers.
- Ophthalmology vocabulary throughout (slit-lamp, fundoscopy, OCT, FFA, gonioscopy,
  etc.). No generic filler.`;

interface RawArtifacts {
  flashcards?: unknown;
  microlearning?: unknown;
  infographics?: unknown;
}

const MICRO_KINDS = new Set<StudyArtifacts['microlearning'][number]['kind']>([
  'video',
  'reading',
  'flash',
]);

function asString(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function normalize(parsed: RawArtifacts): StudyArtifacts {
  const flashcards = (Array.isArray(parsed.flashcards) ? parsed.flashcards : [])
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { q: asString(o.q, 500), a: asString(o.a, 240) };
    })
    .filter((c) => c.q.length > 0 && c.a.length > 0)
    .slice(0, 8);

  const microlearning = (Array.isArray(parsed.microlearning) ? parsed.microlearning : [])
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const kind = (typeof o.kind === 'string' && MICRO_KINDS.has(o.kind as never)
        ? o.kind
        : 'reading') as StudyArtifacts['microlearning'][number]['kind'];
      return { title: asString(o.title, 160), dur: asString(o.dur, 24) || '5 min', kind };
    })
    .filter((m) => m.title.length > 0)
    .slice(0, 4);

  const infographics = (Array.isArray(parsed.infographics) ? parsed.infographics : [])
    .map((g) => {
      const o = (g ?? {}) as Record<string, unknown>;
      return { title: asString(o.title, 160), sub: asString(o.sub, 120) };
    })
    .filter((g) => g.title.length > 0)
    .slice(0, 4);

  return { flashcards, microlearning, infographics };
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
 * Generate study artifacts for a session from lightweight metadata grounding.
 * Lets `GeminiUnavailableError` (AI unreachable / unconfigured) propagate so the
 * caller can return a clean 503 — never returns fabricated placeholder content.
 */
export async function generateStudyArtifacts({
  sessionId,
}: {
  sessionId: string;
}): Promise<StudyArtifacts> {
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

  const objectives = readObjectives(session.objectives);
  const docTitles = links.map((l) => l.document.title).filter(Boolean);
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
  if (docTitles.length) {
    contextLines.push('Linked preread titles (for grounding — file contents are NOT provided):');
    for (const t of docTitles) contextLines.push(`- ${t}`);
  }
  contextLines.push(
    'Produce the study-artifacts JSON now for this topic, grounded in the context above.',
  );

  const raw = await geminiGenerate({
    systemInstruction: SYSTEM_PROMPT,
    userParts: [{ text: contextLines.join('\n') }],
    responseMimeType: 'application/json',
    temperature: 0.35,
  });

  return normalize(tryParseJson<RawArtifacts>(raw));
}

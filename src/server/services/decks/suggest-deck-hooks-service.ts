// ════════════════════════════════════════════════════════════════════════════
// AI Deck-Hook Suggestion — slide-grounded
// ════════════════════════════════════════════════════════════════════════════
// The deck-studio Hooks tab calls this with the focused slide. Gemini drafts up
// to 3 live-session engagement hooks anchored to THAT slide's title + bullets +
// speaker notes, using the real LiveHookKind enum. Output is DRAFTS only —
// nothing persists here; the presenter reviews/edits then creates each via the
// existing POST /api/classroom/sessions/[id]/hooks endpoint.
//
// Mirrors the structure of suggest-polls-service so route + review-UI patterns
// stay consistent across the codebase.

import { db } from '@/lib/db';
import { LiveHookKind, Role } from '@prisma/client';
import { geminiGenerate, tryParseJson, GeminiUnavailableError } from '@/server/services/ai/gemini';

export class SuggestDeckHooksError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'NO_CONTEXT' | 'AI_UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

const VALID_KINDS = new Set<LiveHookKind>([
  LiveHookKind.TRUE_FALSE,
  LiveHookKind.POLL,
  LiveHookKind.ONE_WORD,
  LiveHookKind.REPEAT_CONCEPT,
  LiveHookKind.DILEMMA,
]);

const SYSTEM_PROMPT = `You are an ophthalmology medical educator at LV Prasad Eye Institute helping a presenter prepare a live teaching session.
Given ONE slide's content, draft up to 3 live-engagement "hooks" — short prompts that fire to learners while that slide is on screen. Each must be anchored to THIS slide's content, never generic.

Hook kinds (use the exact UPPERCASE enum value):
- "POLL"           : multiple-choice question. Provide 3-4 parallel options.
- "TRUE_FALSE"     : one testable claim. options MUST be exactly ["True","False"]. Set "correctOption".
- "ONE_WORD"       : a fill-in-the-blank expecting a single medical term. No options.
- "REPEAT_CONCEPT" : "Explain in your own words: <concept from the slide>". No options.
- "DILEMMA"        : a realistic clinical management decision. Provide 3 options.

Output strict JSON only, no prose, no markdown fences:
{
  "hooks": [
    { "kind": "POLL"|"TRUE_FALSE"|"ONE_WORD"|"REPEAT_CONCEPT"|"DILEMMA", "prompt": string, "options"?: string[], "correctOption"?: string }
  ]
}

Rules:
- Pick a MIX of kinds across the drafts when the slide allows it.
- Each "prompt" <= 180 chars. Each option <= 80 chars.
- "options" REQUIRED for POLL (3-4), TRUE_FALSE (["True","False"]) and DILEMMA (3); omit for ONE_WORD/REPEAT_CONCEPT.
- Indian clinical context, generic drug names only.
- Anchor every hook to something actually on the slide. If the slide is thin, return fewer than 3.
- Never invent dosages, cutoffs, drug names, or facts not implied by the slide.`;

interface RawHook {
  kind?: unknown;
  prompt?: unknown;
  options?: unknown;
  correctOption?: unknown;
}

export interface SuggestedDeckHook {
  kind: LiveHookKind;
  prompt: string;
  options: string[] | null;
  correctOption: string | null;
}

export interface SuggestDeckHooksInput {
  jobId: string;
  slideId: string;
  actor: { userId: string; role: Role };
}

const PRIVILEGED: Role[] = [Role.ADMIN, Role.PROGRAM_DIRECTOR];

export async function suggestDeckHooks(
  input: SuggestDeckHooksInput,
): Promise<{ hooks: SuggestedDeckHook[] }> {
  // 1. Ownership — mirror /api/decks/[jobId]/analyze.
  const job = await db.deckForgeJob.findUnique({
    where: { id: input.jobId },
    select: { id: true, requestedById: true },
  });
  if (!job) throw new SuggestDeckHooksError('NOT_FOUND', 'Deck not found');
  if (job.requestedById !== input.actor.userId && !PRIVILEGED.includes(input.actor.role)) {
    throw new SuggestDeckHooksError('FORBIDDEN', 'Not your deck');
  }

  // 2. Load the focused slide (must belong to this deck).
  const slide = await db.slide.findFirst({
    where: { id: input.slideId, deckForgeJobId: input.jobId },
    select: { title: true, bullets: true, speakerNotes: true },
  });
  if (!slide) throw new SuggestDeckHooksError('NOT_FOUND', 'Slide not found in this deck');

  const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean) : [];
  if (!slide.title.trim() && bullets.length === 0) {
    throw new SuggestDeckHooksError('NO_CONTEXT', 'This slide has no content to draft hooks from');
  }

  const userText =
    `Slide title: ${slide.title || '(untitled)'}\n` +
    (bullets.length > 0 ? `Bullets:\n${bullets.map((b) => `- ${b}`).join('\n')}\n` : '') +
    (slide.speakerNotes ? `Speaker notes: ${slide.speakerNotes.slice(0, 600)}\n` : '') +
    `\nDraft the hooks JSON now.`;

  // 3. Gemini.
  let raw: string;
  try {
    raw = await geminiGenerate({
      systemInstruction: SYSTEM_PROMPT,
      userParts: [{ text: userText }],
      responseMimeType: 'application/json',
      temperature: 0.6, // light creativity so "Regenerate" yields variety
    });
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      throw new SuggestDeckHooksError('AI_UNAVAILABLE', 'AI is temporarily unavailable. Please try again in a moment.');
    }
    throw err;
  }

  let parsed: { hooks?: unknown };
  try {
    parsed = tryParseJson<{ hooks?: unknown }>(raw);
  } catch {
    throw new SuggestDeckHooksError('AI_UNAVAILABLE', 'AI returned an unexpected response. Please retry.');
  }

  // 4. Validate + normalise to the real enum.
  const hooks: SuggestedDeckHook[] = [];
  const list = Array.isArray(parsed.hooks) ? parsed.hooks : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as RawHook;
    const kind = typeof r.kind === 'string' ? (r.kind.toUpperCase() as LiveHookKind) : undefined;
    if (!kind || !VALID_KINDS.has(kind)) continue;
    const prompt = typeof r.prompt === 'string' ? r.prompt.trim().slice(0, 200) : '';
    if (prompt.length < 6) continue;

    let options: string[] | null = null;
    if (kind === LiveHookKind.TRUE_FALSE) {
      options = ['True', 'False'];
    } else if (kind === LiveHookKind.POLL || kind === LiveHookKind.DILEMMA) {
      const opts = Array.isArray(r.options)
        ? r.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim().slice(0, 80)).filter(Boolean).slice(0, 4)
        : [];
      if (opts.length < 2) continue; // a poll/dilemma without options is unusable
      options = opts;
    }

    const correctRaw = typeof r.correctOption === 'string' ? r.correctOption.trim() : '';
    const correctOption = options && options.includes(correctRaw) ? correctRaw : null;

    hooks.push({ kind, prompt, options, correctOption });
    if (hooks.length >= 3) break;
  }

  return { hooks };
}

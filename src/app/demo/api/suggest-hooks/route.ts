// POST /demo/api/suggest-hooks — demo-only, slide-grounded hook drafts.
//
// The deck-studio Hooks tab calls this with the *active slide's* content
// (title + bullets). Gemini drafts up to 3 engagement hooks anchored to that
// slide. Output is DRAFTS only — the presenter reviews, edits, regenerates,
// or adds each one in the UI. Nothing persists (demo is frontend-only, so
// this route lives under /demo/* which auth.config treats as public).

import { geminiGenerate, tryParseJson, GeminiUnavailableError } from '@/server/services/ai/gemini';

// Kind vocabulary matches the demo Hooks tab's HOOK_TYPES exactly so drafts
// drop straight into the existing UI without a mapping layer.
const VALID_KINDS = new Set(['poll', 'tf', 'open', 'reflection']);

const SYSTEM_PROMPT = `You are an ophthalmology medical educator at LV Prasad Eye Institute.
You are helping a presenter prepare a live lecture. Given ONE slide's content, draft engagement "hooks" — short prompts that trigger real-time learner responses while that slide is on screen.

You receive the slide title and its bullet points. Draft up to 3 hooks, each directly anchored to THIS slide's content — never generic.

Hook kinds (use the exact lowercase value):
- "poll"       : multiple-choice question. Provide 3-4 parallel options.
- "tf"         : a single testable True/False claim. Phrase "label" so it ends with "— True or False?".
- "open"       : an open-ended question expecting a short free-text / one-word answer.
- "reflection" : a "think about your own practice" prompt, no single right answer.

Output strict JSON only, no prose, no markdown fences:
{
  "hooks": [
    { "kind": "poll"|"tf"|"open"|"reflection", "label": string, "options"?: [string, ...] }
  ]
}

Rules:
- Pick a MIX of kinds across the 3 drafts when the slide allows it.
- "options" is REQUIRED for "poll" (3-4 items) and omitted for the others.
- Each "label" is a single question/claim, <= 160 chars, ending appropriately (poll/open end with "?").
- Indian clinical context, generic drug names only.
- Anchor every hook to something actually on the slide. If the slide is thin, return fewer than 3.
- Never invent dosages, cutoffs, or facts not implied by the slide.`;

interface DraftHook {
  kind: string;
  label: string;
  options?: string[];
}

export async function POST(req: Request): Promise<Response> {
  let body: { slideTitle?: unknown; bullets?: unknown; deckTitle?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const slideTitle = typeof body.slideTitle === 'string' ? body.slideTitle.trim() : '';
  const bullets = Array.isArray(body.bullets)
    ? body.bullets.filter((b): b is string => typeof b === 'string').map((b) => b.trim()).filter(Boolean)
    : [];
  const deckTitle = typeof body.deckTitle === 'string' ? body.deckTitle.trim() : '';

  if (!slideTitle && bullets.length === 0) {
    return Response.json(
      { ok: false, error: 'Slide has no content to draft hooks from' },
      { status: 422 },
    );
  }

  const userText =
    (deckTitle ? `Deck: ${deckTitle}\n` : '') +
    `Slide title: ${slideTitle || '(untitled)'}\n` +
    (bullets.length > 0 ? `Bullets:\n${bullets.map((b) => `- ${b}`).join('\n')}\n` : '') +
    `\nDraft the hooks JSON now.`;

  let raw: string;
  try {
    raw = await geminiGenerate({
      systemInstruction: SYSTEM_PROMPT,
      userParts: [{ text: userText }],
      responseMimeType: 'application/json',
      temperature: 0.6, // a touch creative so "Regenerate" yields variety
    });
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return Response.json(
        { ok: false, error: 'AI is temporarily unavailable. Please try again in a moment.' },
        { status: 503 },
      );
    }
    return Response.json({ ok: false, error: 'Could not draft hooks. Please retry.' }, { status: 502 });
  }

  let parsed: { hooks?: unknown };
  try {
    parsed = tryParseJson<{ hooks?: unknown }>(raw);
  } catch {
    return Response.json({ ok: false, error: 'AI returned an unexpected response. Please retry.' }, { status: 502 });
  }

  const hooks: DraftHook[] = [];
  if (Array.isArray(parsed.hooks)) {
    for (const item of parsed.hooks) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const kind = typeof r.kind === 'string' ? r.kind.toLowerCase() : '';
      const label = typeof r.label === 'string' ? r.label.trim().slice(0, 200) : '';
      if (!VALID_KINDS.has(kind) || label.length < 6) continue;
      const options =
        kind === 'poll' && Array.isArray(r.options)
          ? r.options
              .filter((o): o is string => typeof o === 'string')
              .map((o) => o.trim().slice(0, 100))
              .filter(Boolean)
              .slice(0, 4)
          : undefined;
      if (kind === 'poll' && (!options || options.length < 2)) continue;
      hooks.push({ kind, label, ...(options ? { options } : {}) });
      if (hooks.length >= 3) break;
    }
  }

  if (hooks.length === 0) {
    return Response.json(
      { ok: false, error: 'No usable hooks for this slide — try adding more detail to the bullets.' },
      { status: 422 },
    );
  }

  return Response.json({ ok: true, hooks });
}

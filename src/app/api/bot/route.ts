// ════════════════════════════════════════════════════════════════════════════
// POST /api/bot — Teaching & Reflection Bot answer generation
// ════════════════════════════════════════════════════════════════════════════
// Takes a learner's clinical question and returns a structured teaching reply:
// an evidence-based answer, a realistic case example, one MCQ, and reflective
// prompts. Generated through the shared AI router (aiEnhanceContent), which
// routes Opus → DeepSeek → Gemini Flash and auto-falls to whatever key is
// present — so this works on Gemini today and upgrades itself if an Anthropic
// key is added later, with no code change.
//
// The client degrades gracefully to its built-in curated knowledge base if this
// endpoint errors, so a missing key or upstream blip never breaks the bot.

import { z } from 'zod';
import {
  requireAuth,
  requireCsrf,
  parseBody,
  jsonOk,
  jsonError,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  aiEnhanceContentJson,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AskSchema = z.object({
  question: z.string().trim().min(3).max(2000),
});

// The shape the UI renders. We validate the model's JSON against this so a
// malformed reply is caught server-side and surfaced as a clean error (the
// client then falls back to its curated knowledge base).
const BotReplySchema = z.object({
  answer: z.string().min(1),
  caseExample: z.object({
    title: z.string().min(1),
    scenario: z.string().min(1),
    insight: z.string().min(1),
  }),
  quiz: z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).length(4),
    correct: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
  }),
  reflection: z.object({
    questions: z.array(z.string().min(1)).min(2).max(4),
  }),
});

const SYSTEM_PROMPT = `You are the Teaching & Reflection Bot for Vaidix, a postgraduate ophthalmology teaching platform. Your audience is residents and faculty.

For the learner's question, respond as a senior clinical educator with a single JSON object — no prose, no markdown, no code fences — matching EXACTLY this shape:

{
  "answer": "A concise, evidence-based teaching answer (3-6 sentences). Reference landmark trials/guidelines by name where relevant. Be accurate and clinically grounded.",
  "caseExample": {
    "title": "Short case title",
    "scenario": "A realistic, specific clinical vignette (patient age, presentation, key findings/investigations).",
    "insight": "The teaching point the case illustrates and how it was managed."
  },
  "quiz": {
    "question": "One single-best-answer MCQ that tests the key concept.",
    "options": ["option A", "option B", "option C", "option D"],
    "correct": 0,
    "explanation": "Why the correct option is right (and briefly why others are not)."
  },
  "reflection": {
    "questions": ["Open reflective question 1", "Open reflective question 2", "Open reflective question 3"]
  }
}

Rules:
- "options" MUST contain exactly 4 entries. "correct" is the 0-based index of the right option.
- "reflection.questions" MUST contain exactly 3 open-ended questions that prompt self-assessment.
- Keep it educational and evidence-based. This is a teaching aid, not patient-specific medical advice.
- If the question is outside ophthalmology, answer the general clinical-reasoning principle and still provide an illustrative case, quiz, and reflection.
- Output ONLY the JSON object.`;

export async function POST(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;

    const parsed = await parseBody(req, AskSchema);
    if (!parsed.ok) return parsed.response;

    // Billable upstream — fail-closed, per-user bucket.
    const rl = await checkRateLimit({ ...LIMITS.BOT_ASK, bucket: `bot:ask:${gate.user.id}` });
    if (!rl.allowed) {
      return jsonError(
        'RATE_LIMITED',
        'You have reached the hourly limit for the Teaching Bot. Please try again later.',
        429,
      );
    }

    let raw: unknown;
    try {
      raw = await aiEnhanceContentJson<unknown>({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: parsed.data.question,
        temperature: 0.4,
        maxTokens: 2048,
      });
    } catch (err) {
      if (err instanceof AiUnavailableError) return jsonError('AI_UNAVAILABLE', err.message, 503);
      if (err instanceof AiUnparseableError) return jsonError('AI_UNPARSEABLE', err.message, 502);
      throw err;
    }

    const shaped = BotReplySchema.safeParse(raw);
    if (!shaped.success) {
      // Model produced JSON of the wrong shape — never surface internals.
      return jsonError('AI_BAD_SHAPE', 'The assistant returned an unexpected response. Please try again.', 502);
    }

    return jsonOk(shaped.data);
  } catch (err) {
    return handleUnexpected(err);
  }
}

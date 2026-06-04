// /api/learners/[id]/coach
// Teaching Bot Reinforcement Coach.
// POST: ask the coach a free-form question. Returns { answer, followUpQuiz,
//       caseExample } via Gemini-2.5-flash with an ophthalmology coach persona.
//       Falls back to a deterministic stub when GEMINI_API_KEY is absent or
//       Gemini is unavailable, so the route never 500s in dev.
//
// Stateless  — no Conversation/Message persistence (would need a new
// CoachInteraction model since Conversation requires a caseId). Persistence
// lands in a later phase alongside the journal/coach surface.

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { isUserInProgram } from '@/server/services/program-service';
import { env } from '@/lib/env';
import { geminiGenerate, GeminiUnavailableError, GeminiUnparseableError, tryParseJson } from '@/server/services/ai/gemini';

const askSchema = z.object({
  question: z.string().min(1).max(2000),
});

interface CoachReply {
  answer: string;
  followUpQuiz: string;
  caseExample: string;
  /** Client-facing label. 'ai' = real coach reply; 'stub' = offline fallback. Provider name is deliberately omitted. */
  source: 'ai' | 'stub';
}

const COACH_SYSTEM_PROMPT = `You are a senior ophthalmology consultant at LV Prasad Eye Institute coaching a resident outside session hours.

Your reply MUST be strict JSON in this shape (no prose, no fences):
{
  "answer": string,        // 80-220 words, plain English, mechanism + clinical pearl
  "followUpQuiz": string,  // a single concrete question testing application of the answer
  "caseExample": string    // a 1-2 sentence Indian-context vignette where the answer matters
}

Rules:
- Indian clinical context only (LVPEI / common Indian presentations). No US drug brand names unless they are also the standard name in India.
- No jargon you wouldn't say to a 1st-year resident. Define abbreviations on first use.
- If the question is off-topic for ophthalmology, set "answer" to "That's outside ophthalmology — let's stay focused on eye care." and emit a short relevant pivot quiz/case.
- Never invent dosages. If a dose is unclear, say "follow current LVPEI protocol" instead.`;

async function geminiCoachResponse(question: string): Promise<CoachReply> {
  const text = await geminiGenerate({
    systemInstruction: COACH_SYSTEM_PROMPT,
    userParts: [{ text: `Resident question:\n"""\n${question}\n"""\n\nReply as JSON only.` }],
    responseMimeType: 'application/json',
    temperature: 0.4,
  });
  const parsed = tryParseJson<{ answer?: string; followUpQuiz?: string; caseExample?: string }>(text);
  return {
    answer: typeof parsed.answer === 'string' && parsed.answer.length > 0 ? parsed.answer : 'No answer returned.',
    followUpQuiz: typeof parsed.followUpQuiz === 'string' ? parsed.followUpQuiz : '',
    caseExample: typeof parsed.caseExample === 'string' ? parsed.caseExample : '',
    source: 'ai',
  };
}

function stubCoachResponse(question: string): CoachReply {
  // Used when the upstream AI key is absent or the provider fails. Keeps dev
  // unblocked. The user-facing answer text must NOT name the provider — ops
  // can read server logs for the real reason.
  return {
    answer: `Offline coach reply for: "${question.slice(0, 80)}". The AI assistant is unavailable right now — please try again in a moment.`,
    followUpQuiz: 'Follow-up: which finding most reliably differentiates the two diagnoses?',
    caseExample: 'Case example: 58 y/o diabetic with sudden vision loss — apply the framework above.',
    source: 'stub',
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, askSchema);
  if (!body.ok) return body.response;
  const { id: learnerId } = await ctx.params;

  // A learner can coach themselves; admins/PD/faculty can coach anyone.
  if (
    learnerId !== auth.user.id &&
    auth.user.role !== Role.ADMIN &&
    auth.user.role !== Role.PROGRAM_DIRECTOR &&
    auth.user.role !== Role.FACULTY
  ) {
    return jsonError('FORBIDDEN', 'Cannot coach another user', 403);
  }
  if (learnerId !== auth.user.id) {
    const sameProgram = auth.user.activeProgramId
      ? await isUserInProgram(learnerId, auth.user.activeProgramId)
      : false;
    if (!sameProgram) return jsonError('FORBIDDEN', 'Learner is not in your active program', 403);
  }

  const rl = await checkRateLimit({ bucket: `coach:${auth.user.id}`, ...LIMITS.COACH_ASK });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Coach throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const learner = await db.user.findUnique({ where: { id: learnerId }, select: { id: true } });
    if (!learner) return jsonError('NOT_FOUND', 'Learner not found', 404);

    let reply: CoachReply;
    if (env.GEMINI_API_KEY) {
      try {
        reply = await geminiCoachResponse(body.data.question);
      } catch (err) {
        if (err instanceof GeminiUnavailableError || err instanceof GeminiUnparseableError) {
          console.warn('[coach] AI failed, falling back to stub:', err);
          reply = stubCoachResponse(body.data.question);
        } else {
          throw err;
        }
      }
    } else {
      reply = stubCoachResponse(body.data.question);
    }
    return jsonOk({ reply });
  } catch (err) {
    return handleUnexpected(err);
  }
}

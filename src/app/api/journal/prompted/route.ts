// /api/journal/prompted — Reflection Bot prompts (Stream D #20)
// GET: returns the next reflection prompt for the current user (rotates).
// POST: saves a journal entry tagged with prompted=true and the promptType.

import { z } from 'zod';
import { db } from '@/lib/db';
import { handleUnexpected, jsonOk, parseBody, requireAuth } from '@/server/services/api-helpers';

const PROMPTS = [
  { type: 'WHAT_LEARNED', text: 'What is the single most important thing you learned today?' },
  { type: 'WHAT_UNCLEAR', text: 'What still feels unclear or uncertain to you?' },
  { type: 'CLINICAL_APPLICATION', text: 'How will you apply what you learned in your next clinical encounter?' },
  { type: 'POST_SESSION_REFLECTION', text: 'Reflect on the session: what surprised you, what reinforced your prior thinking?' },
];

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  // Rotate by date so the prompt feels different day-to-day.
  const idx = (Date.now() / (1000 * 60 * 60 * 24)) | 0;
  const prompt = PROMPTS[idx % PROMPTS.length];
  return jsonOk({ prompt });
}

const saveSchema = z.object({
  promptType: z.enum(['WHAT_LEARNED', 'WHAT_UNCLEAR', 'CLINICAL_APPLICATION', 'POST_SESSION_REFLECTION']),
  body: z.string().min(1).max(8000),
  title: z.string().max(200).optional(),
  sessionId: z.string().optional(),
  caseId: z.string().optional(),
  tags: z.array(z.string().min(1).max(60)).max(15).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, saveSchema);
  if (!body.ok) return body.response;

  try {
    const entry = await db.journalEntry.create({
      data: {
        userId: auth.user.id,
        title: body.data.title ?? PROMPTS.find((p) => p.type === body.data.promptType)?.text.slice(0, 80) ?? null,
        body: body.data.body,
        tags: body.data.tags ?? [],
        sessionId: body.data.sessionId ?? null,
        caseId: body.data.caseId ?? null,
        prompted: true,
        promptType: body.data.promptType,
      },
      select: { id: true, createdAt: true },
    });
    return jsonOk({ entry: { id: entry.id, createdAt: entry.createdAt.toISOString() } }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AI Poll Suggestion
// ════════════════════════════════════════════════════════════════════════════
// Presenter clicks "Suggest with AI" on the new Polls tab → Gemini drafts up
// to 3 multi-choice polls grounded in the session's objectives + uploaded
// study material. Output is "draft polls" only — nothing persists. The
// presenter accepts (which calls POST /hooks to create the row) or dismisses.
//
// Output mirrors the existing objectives/prompts suggest services so the
// route + UI patterns stay identical and Codex review can compare one-to-one.

import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Role } from '@prisma/client';
import {
  aiExtractFromSourceJson,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';

export class SuggestPollsError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'NO_CONTEXT' | 'AI_UNAVAILABLE',
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const TOTAL_INLINE_CAP_BYTES = 20 * 1024 * 1024;
const PER_FILE_CAP_BYTES = 8 * 1024 * 1024;

const INGESTIBLE_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const SYSTEM_PROMPT = `You are an ophthalmology educator at LV Prasad Eye Institute drafting *pre-session* poll questions for a structured pre-class temperature check. Residents see these BEFORE the session and vote; the presenter sees aggregate results to tailor the session.

Good pre-session polls measure a misconception or decision point, not factual recall. They give the presenter a signal of where the room stands. Examples for an anterior uveitis session:
  - { q: "First-line workup when uveitis is bilateral, granulomatous, and recurrent?", options: ["FTA-ABS + Quantiferon + CXR", "ANA + RF + CRP", "MRI brain + LP", "Vitreous biopsy"] }
  - { q: "Most useful clinical clue that argues FOR herpetic uveitis at the slit lamp?", options: ["Mutton-fat KPs", "Sectoral iris atrophy", "Synechiae 360°", "Hypopyon"] }

You receive: the session title, the speaker's learning objectives, and the study material.

Output strict JSON only, no prose, no fences:
{
  "polls": [
    { "q": string, "options": [string, string, string, string], "correct": string? }
  ]
}

Rules:
- Each poll has exactly 4 options. No more, no fewer.
- One concept per poll. No "all of the above" or "none of the above".
- Indian clinical context. Generic drug names only.
- Options must be parallel (similar length + grammar).
- "correct" is OPTIONAL: include only if the question has a single defensible right answer (e.g. evidence-based). Open-opinion questions return without "correct".
- Output AT MOST 3 polls. If material is thin, return fewer. Quality over count.
- Don't invent topics absent from the objectives or material.
- Each "q" must end with "?" and be <= 180 chars. Each option <= 80 chars.`;

async function fetchInline(s3Key: string): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const stream = out.Body as AsyncIterable<Uint8Array> | undefined;
  if (!stream) throw new Error(`Empty S3 body for ${s3Key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export interface SuggestedPoll {
  q: string;
  options: string[];
  correct: string | null;
}

export interface SuggestPollsInput {
  sessionId: string;
  actor: { userId: string; role: Role };
}

export interface SuggestPollsResult {
  polls: SuggestedPoll[];
}

export async function suggestPollsForSession(
  input: SuggestPollsInput
): Promise<SuggestPollsResult> {
  if (!FACULTY_LIKE.includes(input.actor.role)) {
    throw new SuggestPollsError('FORBIDDEN', 'Only faculty/PD/admin can request poll drafts');
  }
  const session = await db.teachingSession.findUnique({
    where: { id: input.sessionId, deletedAt: null },
    select: { id: true, title: true, hostId: true, proposedBy: true, objectives: true },
  });
  if (!session) throw new SuggestPollsError('NOT_FOUND', 'Session not found');

  const isPriv = input.actor.role === Role.ADMIN || input.actor.role === Role.PROGRAM_DIRECTOR;
  const isHost = session.hostId === input.actor.userId || session.proposedBy === input.actor.userId;
  if (!isPriv && !isHost) {
    throw new SuggestPollsError('FORBIDDEN', 'Only the host (or PD/admin) can request poll drafts');
  }

  const objectives = Array.isArray(session.objectives)
    ? (session.objectives as Array<{ text: string }>).slice(0, 10)
    : [];

  const links = await db.documentSessionLink.findMany({
    where: { sessionId: input.sessionId, isPreSession: true, document: { deletedAt: null } },
    orderBy: { preSessionRank: 'asc' },
    select: {
      document: {
        select: { id: true, title: true, s3Key: true, mimeType: true, sizeBytes: true },
      },
    },
  });

  if (objectives.length === 0 && links.length === 0) {
    throw new SuggestPollsError(
      'NO_CONTEXT',
      'Add learning objectives or study material first — AI needs something to draft polls from'
    );
  }

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  parts.push({
    text:
      `Session title: ${session.title}\n\n` +
      (objectives.length > 0
        ? `Speaker's learning objectives:\n${objectives.map((o, i) => `${i + 1}. ${o.text}`).join('\n')}\n`
        : 'Speaker has not yet written objectives.\n'),
  });

  let totalBytes = 0;
  let truncated = false;
  for (const link of links) {
    const doc = link.document;
    if (!INGESTIBLE_MIMES.has(doc.mimeType)) {
      truncated = true;
      continue;
    }
    const size = Number(doc.sizeBytes);
    if (size > PER_FILE_CAP_BYTES) {
      truncated = true;
      continue;
    }
    if (totalBytes + size > TOTAL_INLINE_CAP_BYTES) {
      truncated = true;
      break;
    }
    try {
      const buf = await fetchInline(doc.s3Key);
      parts.push({ text: `[Begin study material: ${doc.title}]` });
      parts.push({ inlineData: { mimeType: doc.mimeType, data: buf.toString('base64') } });
      parts.push({ text: `[End material: ${doc.title}]` });
      totalBytes += size;
    } catch {
      truncated = true;
    }
  }

  if (truncated) {
    parts.push({
      text: 'Note: some material was skipped (size/format limits). Draft polls only from what is included.',
    });
  }
  parts.push({ text: 'Produce the polls JSON now.' });

  let result: { polls?: unknown };
  try {
    result = await aiExtractFromSourceJson<{ polls?: unknown }>({
      systemPrompt: SYSTEM_PROMPT,
      parts,
      temperature: 0.3,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiUnparseableError) {
      console.warn('[suggest-polls] AI failure (sanitized):', err.message);
      throw new SuggestPollsError(
        'AI_UNAVAILABLE',
        'AI servers are busy. Please retry in about 30 seconds.',
        30,
      );
    }
    throw err;
  }

  const polls: SuggestedPoll[] = [];
  if (Array.isArray(result.polls)) {
    for (const raw of result.polls) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const q = typeof r.q === 'string' ? r.q.trim().slice(0, 200) : '';
      if (q.length < 8 || !q.includes('?')) continue;
      const optsRaw = Array.isArray(r.options) ? r.options : [];
      const options = optsRaw
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim().slice(0, 100))
        .filter((o) => o.length > 0);
      // Insist on 4 options to match the system prompt's contract. Polls
      // that don't conform are dropped rather than auto-padded — better to
      // return 2 great polls than 3 sloppy ones.
      if (options.length !== 4) continue;
      const correctRaw = typeof r.correct === 'string' ? r.correct.trim() : '';
      const correct = options.includes(correctRaw) ? correctRaw : null;
      polls.push({ q, options, correct });
      if (polls.length >= 3) break;
    }
  }
  return { polls };
}

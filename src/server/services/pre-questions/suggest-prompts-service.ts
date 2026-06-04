// ════════════════════════════════════════════════════════════════════════════
// AI Doubt-Prompt Suggestion — W9.3
// ════════════════════════════════════════════════════════════════════════════
// Faculty publishes 1–3 "doubt prompts" that frame what residents ask before
// the session — e.g. "What confuses you most about herpetic uveitis?". This
// service drafts up to 3 candidate prompts grounded in the session's
// objectives + uploaded study material. The presenter reviews and decides
// which to publish via the existing PATCH /prep endpoint.
//
// Output mirrors `suggestObjectivesForSession`:
//   - Stateless: returns drafts, persists nothing
//   - Safe to call multiple times — the speaker accepts/dismisses each one
//   - Gemini-only; throws SuggestPromptsError on AI_UNAVAILABLE so the route
//     can map to a 503 with a retry-after hint just like the objectives flow

import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Role } from '@prisma/client';
import {
  aiExtractFromSourceJson,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';

export class SuggestPromptsError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'NO_CONTEXT' | 'AI_UNAVAILABLE',
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

// Same caps the objectives suggest service uses — keeps the prompt budget
// predictable and avoids surprise Gemini bill spikes.
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

const SYSTEM_PROMPT = `You are an ophthalmology educator at LV Prasad Eye Institute drafting "doubt prompts" — short framing questions that residents see *before* a teaching session.

A good doubt prompt invites the resident to share where they are confused, not what they already know. It primes the live discussion by surfacing the highest-value uncertainties. Examples for an anterior uveitis session:
  - "What's the one slit-lamp finding you're never sure how to interpret in suspected uveitis?"
  - "When have you been unsure whether to start steroids vs. wait for workup?"
  - "What's confusing about distinguishing herpetic vs. non-herpetic uveitis at the bedside?"

You receive the session title, the speaker's learning objectives, and the study material residents are expected to review.

Output strict JSON only, no prose, no fences:
{
  "suggestions": [string, string, string]   // up to 3 prompts, each <= 180 chars
}

Rules:
- Frame each prompt around uncertainty / confusion / decision points, NOT factual recall.
- Each prompt MUST end with a "?" and read in a conversational voice.
- Indian clinical context. No US drug brand names. Use generic terms.
- Don't repeat the session title back; the resident already sees it.
- Tie each prompt to something in the objectives or material — don't invent topics.
- If the objectives are too thin to support 3 strong prompts, return fewer. Quality over count.`;

interface InternalSession {
  id: string;
  title: string;
  hostId: string;
  proposedBy: string;
  objectives: unknown;
}

async function fetchInline(s3Key: string): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const stream = out.Body as AsyncIterable<Uint8Array> | undefined;
  if (!stream) throw new Error(`Empty S3 body for ${s3Key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export interface SuggestPromptsInput {
  sessionId: string;
  actor: { userId: string; role: Role };
}

export interface SuggestPromptsResult {
  suggestions: string[];
}

export async function suggestDoubtPromptsForSession(
  input: SuggestPromptsInput
): Promise<SuggestPromptsResult> {
  if (!FACULTY_LIKE.includes(input.actor.role)) {
    throw new SuggestPromptsError('FORBIDDEN', 'Only faculty/PD/admin can suggest prompts');
  }
  const session: InternalSession | null = await db.teachingSession.findUnique({
    where: { id: input.sessionId, deletedAt: null },
    select: { id: true, title: true, hostId: true, proposedBy: true, objectives: true },
  });
  if (!session) throw new SuggestPromptsError('NOT_FOUND', 'Session not found');

  const isPriv = input.actor.role === Role.ADMIN || input.actor.role === Role.PROGRAM_DIRECTOR;
  const isHost = session.hostId === input.actor.userId || session.proposedBy === input.actor.userId;
  if (!isPriv && !isHost) {
    throw new SuggestPromptsError('FORBIDDEN', 'Only the host (or PD/admin) can request prompts');
  }

  const objectives = Array.isArray(session.objectives)
    ? (session.objectives as Array<{ text: string; blooms?: number }>).slice(0, 10)
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

  // Either signal is enough; the speaker should at least have written
  // objectives OR uploaded one document before asking AI for prompts.
  if (objectives.length === 0 && links.length === 0) {
    throw new SuggestPromptsError(
      'NO_CONTEXT',
      'Add learning objectives or study material first — AI needs something to draft prompts from'
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
      text: 'Note: some material was skipped (size/format limits). Draft prompts only from what is included.',
    });
  }
  parts.push({ text: 'Produce the suggestions JSON now.' });

  let result: { suggestions?: unknown };
  try {
    result = await aiExtractFromSourceJson<{ suggestions?: unknown }>({
      systemPrompt: SYSTEM_PROMPT,
      parts,
      temperature: 0.4,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiUnparseableError) {
      console.warn('[suggest-prompts] AI failure (sanitized):', err.message);
      throw new SuggestPromptsError(
        'AI_UNAVAILABLE',
        'AI servers are busy. Please retry in about 30 seconds.',
        30,
      );
    }
    throw err;
  }

  const raw = Array.isArray(result.suggestions) ? result.suggestions : [];
  const suggestions = raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().slice(0, 200))
    .filter((s) => s.length >= 8 && s.includes('?'))
    .slice(0, 3);

  return { suggestions };
}

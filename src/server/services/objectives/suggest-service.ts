// ════════════════════════════════════════════════════════════════════════════
// AI Objective Suggestion
// ════════════════════════════════════════════════════════════════════════════
// Speaker uploads study material into the Pre-Conference prep pack. This
// service ingests those docs (multimodal) and asks Gemini to draft up to 5
// learning-objective suggestions the speaker can then accept (or ignore) as
// the real objectives for the session.
//
// The Gemini extraction is the same shape the deck-forge wizard uses
// (aiExtractFromSourceJson) — keep parity so future tooling can reuse the
// upstream prompts. Output is JSON only so the chips can render directly.
//
// Suggestions are **never** persisted as real objectives. The speaker has to
// accept each chip explicitly through the existing prep PATCH route.

import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Role } from '@prisma/client';
import {
  aiExtractFromSourceJson,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';
import {
  extractPptxContent,
  PPTX_MIME_TYPES,
} from '@/server/services/decks/wizard-forge-service';

export class SuggestObjectivesError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'NO_MATERIAL' | 'AI_UNAVAILABLE',
    message: string,
    /** Hint to the client: when to allow Retry. Only set for AI_UNAVAILABLE. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

// Cap total inline payload sent to Gemini per call. Matches the wizard-forge
// budget. Pre-readings beyond the cap are skipped (with a note in the prompt
// so Gemini knows the extraction is partial).
const TOTAL_INLINE_CAP_BYTES = 20 * 1024 * 1024;
const PER_FILE_CAP_BYTES = 8 * 1024 * 1024;

// Document mime types Gemini can ingest natively as inline data. PPTX is
// handled separately via the deck-forge PptxDocument extractor (titles +
// body + speaker notes round-trip across PowerPoint/Keynote exports). .doc,
// .docx, .key, audio, video still fall through to the truncated/skipped
// path until a per-format extractor lands.
const INGESTIBLE_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const SYSTEM_PROMPT = `You are an expert medical-education specialist drafting learning objectives for an ophthalmology clinical teaching session at LV Prasad Eye Institute.

You receive: the session title, optional speaker description, and the study material the speaker uploaded for residents to review beforehand.

Your task: analyse the material and propose up to 5 learning objectives grounded ONLY in the scope of that material. The faculty member will review your suggestions and accept or discard each individually — do not assume any will be used.

Output strict JSON only, no prose, no fences:
{
  "suggestions": [
    { "text": string,   // <= 200 chars, action verb first, single objective
      "blooms": number, // 1..6 — Bloom's cognitive level (1=remember, 2=understand, 3=apply, 4=analyse, 5=evaluate, 6=create)
      "rationale": string // <= 120 chars; source pointer + framework slot tag (see below)
    }
  ]
}

FRAMEWORK COVERAGE — the 5 suggestions TOGETHER must span these four lenses
- BLOOM'S — Prefer higher-order action verbs when the source supports them: Analyse, Compare, Differentiate, Critique, Evaluate, Formulate, Apply, Manage, Justify. Drop to Identify / Describe / List only for foundational anatomy or pure definitions.
- MILLER'S PYRAMID — Show progression across the set:
    • "Knows" (theory) — e.g. "Describe the mechanism of aqueous outflow"
    • "Knows How" (clinical reasoning) — e.g. "Differentiate acute angle-closure from primary angle-closure"
    • "Shows How" (simulated application) — e.g. "Demonstrate gonioscopy technique on a model eye", "Walk through informed consent for cataract surgery"
  Aim for ≥1 Knows-How AND ≥1 Shows-How objective whenever the material supports it.
- CanMEDS — Include AT LEAST ONE objective that addresses a non-Medical-Expert role: Communicator (counselling, breaking bad news, informed consent), Professional (ethics, accountability, conflict of interest), Collaborator (referral pathways, team handover), or Health Advocate (screening, access, low-resource adaptations).
- FINK — When the material touches patient experience, adherence, autonomy, equity, or ethics, include ONE objective on Patient-Centered Care or Ethics (e.g. "Recognise adherence barriers a low-income glaucoma patient faces and adapt the follow-up plan").

QUALITY RULES
- One concept per objective. No compound objectives joined by "and".
- Indian clinical context. Generic drug names only — no US/EU brand names.
- Do NOT invent topics absent from the source. If material is thin, return 1-2 suggestions rather than padding to 5. Quality over count.
- Be specific. "Manage glaucoma" is weak; "Choose first-line topical therapy for primary open-angle glaucoma in a treatment-naive adult" is good.
- "rationale" carries TWO things in <= 120 chars: (a) a concrete source pointer ("p3 KP morphology table", "case 2 of the deck") AND (b) the framework slot in brackets — "[Miller: Shows How]", "[CanMEDS: Communicator]", "[Fink: Ethics]", or "[Bloom: Analyse]". Pick whichever framework this objective most strongly fills. Example: "Slide 7 vignette · [Miller: Knows How]".`;

export interface SuggestedObjective {
  text: string;
  blooms: number;
  rationale: string;
}

export interface SuggestObjectivesInput {
  sessionId: string;
  actor: { userId: string; role: Role };
}

export interface SuggestObjectivesResult {
  suggestions: SuggestedObjective[];
  materialCount: number;
  truncated: boolean;
}

async function fetchInline(s3Key: string): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const stream = out.Body as AsyncIterable<Uint8Array> | undefined;
  if (!stream) throw new Error(`Empty S3 body for ${s3Key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function suggestObjectivesForSession(
  input: SuggestObjectivesInput
): Promise<SuggestObjectivesResult> {
  if (!FACULTY_LIKE.includes(input.actor.role)) {
    throw new SuggestObjectivesError('FORBIDDEN', 'Only faculty/PD/admin can suggest objectives');
  }
  const session = await db.teachingSession.findUnique({
    where: { id: input.sessionId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      hostId: true,
      proposedBy: true,
    },
  });
  if (!session) throw new SuggestObjectivesError('NOT_FOUND', 'Session not found');

  const isPriv = input.actor.role === Role.ADMIN || input.actor.role === Role.PROGRAM_DIRECTOR;
  const isHost = session.hostId === input.actor.userId || session.proposedBy === input.actor.userId;
  if (!isPriv && !isHost) {
    throw new SuggestObjectivesError('FORBIDDEN', 'Only the host (or PD/admin) can request suggestions');
  }

  const links = await db.documentSessionLink.findMany({
    where: { sessionId: input.sessionId, isPreSession: true, document: { deletedAt: null } },
    orderBy: { preSessionRank: 'asc' },
    select: {
      document: {
        select: {
          id: true,
          title: true,
          s3Key: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  });

  if (links.length === 0) {
    throw new SuggestObjectivesError(
      'NO_MATERIAL',
      'Add at least one study-pack document before requesting AI suggestions'
    );
  }

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  parts.push({
    text: `Session title: ${session.title}\nSession description: ${session.description ?? '(none)'}`,
  });

  let totalBytes = 0;
  let usedCount = 0;
  let truncated = false;

  for (const link of links) {
    const doc = link.document;
    const size = Number(doc.sizeBytes);
    if (size > PER_FILE_CAP_BYTES) {
      truncated = true;
      continue;
    }
    if (totalBytes + size > TOTAL_INLINE_CAP_BYTES) {
      truncated = true;
      break;
    }

    // PPTX path — deterministic text + speaker notes via the shared
    // wizard-forge extractor. Pushed as a plain text part (Gemini doesn't
    // ingest .pptx blobs natively). On parse failure, fall through to the
    // truncated-skip path so a corrupt deck doesn't kill the whole request.
    if (PPTX_MIME_TYPES.has(doc.mimeType)) {
      try {
        const buf = await fetchInline(doc.s3Key);
        const extracted = extractPptxContent(buf, doc.title);
        if (extracted) {
          parts.push({ text: extracted.text });
          totalBytes += size;
          usedCount++;
        } else {
          truncated = true;
        }
      } catch {
        truncated = true;
      }
      continue;
    }

    if (!INGESTIBLE_MIMES.has(doc.mimeType)) {
      truncated = true;
      continue;
    }

    try {
      const buf = await fetchInline(doc.s3Key);
      parts.push({ text: `[Begin study material: ${doc.title}]` });
      parts.push({
        inlineData: { mimeType: doc.mimeType, data: buf.toString('base64') },
      });
      parts.push({ text: `[End material: ${doc.title}]` });
      totalBytes += size;
      usedCount++;
    } catch {
      truncated = true;
    }
  }

  if (usedCount === 0) {
    throw new SuggestObjectivesError(
      'NO_MATERIAL',
      'Study pack contains no AI-readable files yet (need PDF, PPTX, text, markdown, PNG or JPEG)'
    );
  }

  if (truncated) {
    parts.push({
      text: 'Note: some material was skipped (size/format limits). Ground suggestions in the included files only.',
    });
  }
  parts.push({ text: 'Produce the objective-suggestions JSON now.' });

  let result: { suggestions?: unknown };
  try {
    result = await callExtractWithRetry({
      systemPrompt: SYSTEM_PROMPT,
      parts,
      temperature: 0.3,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiUnparseableError) {
      // Log the raw upstream detail server-side for diagnosis; surface only a
      // sanitized message to the caller. Per UI policy we never name the
      // provider (Gemini/Opus/etc) in faculty-facing copy.
      console.warn('[suggest-objectives] AI failure (sanitized for UI):', err.message);
      const friendly = friendlyAiMessage(err.message);
      throw new SuggestObjectivesError('AI_UNAVAILABLE', friendly.message, friendly.retryAfterSeconds);
    }
    throw err;
  }

  const suggestions = normaliseSuggestions(result.suggestions);
  return { suggestions, materialCount: usedCount, truncated };
}

/**
 * Map a raw AI-router error message into (a) a short, provider-agnostic phrase
 * we can show to faculty, and (b) a hint for when Retry should be enabled.
 * The raw upstream message often contains the model name + a JSON dump
 * (`[gemini] Gemini 503: { ... "UNAVAILABLE" }`); we never want either of
 * those reaching the UI.
 *
 * Retry windows are calibrated to typical upstream behavior:
 *   - 503/overloaded: Gemini Flash demand spikes usually clear in ~30s
 *   - 429/rate limit: usually a 60s window
 *   - Quota / auth / config errors: not retriable from the UI — operator fix
 */
function friendlyAiMessage(raw: string): { message: string; retryAfterSeconds?: number } {
  const m = raw.toLowerCase();
  if (/\b503\b|unavailable|overloaded|high demand|temporarily/i.test(m)) {
    return {
      message: 'AI servers are busy. Please retry in about 30 seconds.',
      retryAfterSeconds: 30,
    };
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(m)) {
    return {
      message: 'Too many AI requests right now. Please retry in about 60 seconds.',
      retryAfterSeconds: 60,
    };
  }
  if (/quota|exceeded|billing|credit/i.test(m)) {
    return { message: 'AI service quota reached. Please contact your admin.' };
  }
  if (/api_key|api key|unauthorized|forbidden|\b401\b|\b403\b/i.test(m)) {
    return { message: 'AI service is not configured. Please contact your admin.' };
  }
  if (/timeout|aborted|econn|fetch failed/i.test(m)) {
    return {
      message: 'Couldn’t reach the AI service. Check your connection and retry in 10 seconds.',
      retryAfterSeconds: 10,
    };
  }
  if (/empty .*response|unparseable|invalid json/i.test(m)) {
    return {
      message: 'AI returned an unreadable response. Please retry in 10 seconds.',
      retryAfterSeconds: 10,
    };
  }
  return {
    message: 'AI couldn’t draft suggestions right now. Please retry in 15 seconds.',
    retryAfterSeconds: 15,
  };
}

/**
 * One-shot retry on transient upstream errors (HTTP 5xx / overloaded /
 * timeout). We don't loop forever — a single retry covers most of Gemini's
 * minute-long demand spikes without doubling latency on the happy path.
 */
async function callExtractWithRetry(input: Parameters<typeof aiExtractFromSourceJson>[0]) {
  try {
    return await aiExtractFromSourceJson<{ suggestions?: unknown }>(input);
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    const retriable = /\b(503|502|504|429)\b|unavailable|overloaded|timeout|fetch failed/i.test(err.message);
    if (!retriable) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return await aiExtractFromSourceJson<{ suggestions?: unknown }>(input);
  }
}

function normaliseSuggestions(raw: unknown): SuggestedObjective[] {
  if (!Array.isArray(raw)) return [];
  const out: SuggestedObjective[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (text.length < 8) continue;
    const bloomsRaw = typeof r.blooms === 'number' ? r.blooms : Number(r.blooms);
    const blooms = Number.isFinite(bloomsRaw) ? Math.min(6, Math.max(1, Math.round(bloomsRaw))) : 2;
    const rationale = typeof r.rationale === 'string' ? r.rationale.trim().slice(0, 200) : '';
    out.push({ text: text.slice(0, 280), blooms, rationale });
    if (out.length >= 5) break;
  }
  return out;
}

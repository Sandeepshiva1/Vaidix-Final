// ════════════════════════════════════════════════════════════════════════════
// Post-Session Content Pack
// ════════════════════════════════════════════════════════════════════════════
// Two-pass pipeline for Pearls, Q&A, SJT, PBL extraction from session
// transcripts. Routes through ai/router — never calls providers directly.
//
// Short transcripts (< SHORT_TRANSCRIPT_THRESHOLD chars):
//   Single-pass Opus (aiEnhanceContent) per artifact — same quality, lower cost.
//
// Long transcripts (≥ threshold — typical 1-2 hr sessions):
//   Pass 1 — Gemini aiExtractFromSource: segments full transcript into topics
//             with summaries + key quotes. Gemini handles the full text in one
//             call (1M-token context). Topic digest is the input for Pass 2.
//   Pass 2 — Opus aiEnhanceContent per topic chunk for pearl candidates;
//             Sonnet aiDesign dedupes and ranks to final 3.
//             Q&A / SJT / PBL receive the condensed digest (high-signal).
//
// Fallback: if Gemini segmentation fails, the long path falls through to
// single-pass on the last SHORT_TRANSCRIPT_THRESHOLD chars.

import { db } from '@/lib/db';
import {
  aiExtractFromSourceJson,
  aiEnhanceContentJson,
  aiDesignJson,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';

const MIN_CONTENT_LENGTH = 200;
const SHORT_TRANSCRIPT_THRESHOLD = 12_000;
const MAX_PARALLEL_CHUNKS = 4;

// ─── Segmentation prompt (Gemini — Pass 1) ─────────────────────────────────

const SEGMENT_PROMPT = `You are organizing an ophthalmology teaching session transcript from LVPEI (L V Prasad Eye Institute).
Identify 4–8 distinct clinical topic segments that cover the full transcript.
For each segment return:
- topicLabel: concise title ≤8 words
- summary: 3–6 sentence clinical summary of the key teaching points in this segment
- keyQuotes: up to 3 verbatim quotes with the highest clinical teaching value

Return a JSON array — exactly this shape:
[{"topicLabel": "...", "summary": "...", "keyQuotes": ["...", "..."]}]

Rules:
- The segments must together cover the entire transcript content
- summary must faithfully reflect what was actually said (no invention)
- keyQuotes must be verbatim from the transcript`;

// ─── Pearl prompts ──────────────────────────────────────────────────────────

const PEARL_CHUNK_PROMPT = `You are a clinical educator at LVPEI (L V Prasad Eye Institute).
Extract 1–2 key learning pearls from this ophthalmology topic segment.
Each pearl must be:
- Clinically actionable and specific (no generic statements)
- Grounded in content from this segment
- Written for ophthalmology trainees (residents / fellows)
- Body under 60 words

Return a JSON array with 1–2 objects:
[{"title": "<concise pearl title ≤10 words>", "body": "<clinical pearl ≤60 words>"}]`;

const PEARL_DEDUP_PROMPT = `You are a clinical educator reviewing AI-extracted pearls from an ophthalmology session.
Given these pearl candidates from different topic segments, select and refine exactly 3 final pearls:
- Remove near-duplicates (keep the sharper, more actionable version)
- Prefer clinically actionable pearls over descriptive ones
- Ensure the 3 pearls ideally span different clinical topics
- Refine wording only if needed for clarity — preserve clinical accuracy

Return a JSON array with exactly 3 objects:
[{"title": "<concise pearl title ≤10 words>", "body": "<clinical pearl ≤60 words>"}]`;

const PEARL_PROMPT_SHORT = `You are a clinical educator at LVPEI (L V Prasad Eye Institute).
Extract exactly 3 key learning pearls from the ophthalmology session transcript.
Each pearl must be:
- Clinically actionable and specific (no generic statements)
- Grounded in content from the transcript
- Written for ophthalmology trainees (residents / fellows)
- Body under 60 words

Return a JSON array with exactly 3 objects:
[{"title": "<concise pearl title ≤10 words>", "body": "<clinical pearl ≤60 words>"}]`;

// ─── Q&A / SJT / PBL prompts ───────────────────────────────────────────────

const QA_PROMPT = `You are a clinical educator at LVPEI.
Extract exactly 5 clinically relevant Q&A pairs from this ophthalmology session content.
Questions should be what a trainee might ask; answers should reflect content from the session.
Each answer must be precise and under 80 words.

Return a JSON array with exactly 5 objects:
[{"question": "<question>", "answer": "<answer ≤80 words>"}]`;

const SJT_PROMPT = `You are a clinical educator at LVPEI.
Generate exactly 1 Situational Judgment Test (SJT) case based on clinical content in this ophthalmology session.
The case should present a realistic management dilemma that tests clinical reasoning.
Choose a scenario explicitly present in or directly derivable from the session content.

Return a single JSON object:
{"stem": "<clinical scenario ≤150 words>", "options": ["<A>", "<B>", "<C>", "<D>"], "correctIndex": 0, "rationale": "<why this is correct ≤100 words>"}`;

const PBL_PROMPT = `You are a clinical educator at LVPEI.
Generate exactly 1 Problem-Based Learning (PBL) scenario based on this ophthalmology session content.
The scenario should trigger self-directed enquiry and promote deeper learning of the session's key concepts.

Return a single JSON object:
{"trigger": "<opening clinical trigger ≤100 words>", "objectives": ["<learning objective 1>", "<learning objective 2>", "<learning objective 3>"], "content": "<background notes for facilitators ≤200 words>"}`;

// ─── Types ─────────────────────────────────────────────────────────────────

interface TopicChunk {
  topicLabel: string;
  summary: string;
  keyQuotes: string[];
}

interface RawPearl { title: string; body: string }
interface RawQa { question: string; answer: string }
interface RawSjt { stem: string; options: string[]; correctIndex?: number; rationale: string }
interface RawPbl { trigger: string; objectives: string[]; content: string }

export interface PostSessionPackResult {
  pearls: number;
  qaPairs: number;
  sjtCases: number;
  pblScenarios: number;
  skipped: boolean;
  reason?: string;
}

// ─── Main entry ────────────────────────────────────────────────────────────

export async function generatePostSessionPack(
  sessionId: string,
): Promise<PostSessionPackResult> {
  const transcript = await db.sessionTranscript.findUnique({
    where: { sessionId_language: { sessionId, language: 'en' } },
    select: { id: true, contentText: true, finalized: true },
  });
  if (!transcript?.contentText || transcript.contentText.length < MIN_CONTENT_LENGTH) {
    return { pearls: 0, qaPairs: 0, sjtCases: 0, pblScenarios: 0, skipped: true, reason: 'insufficient-content' };
  }

  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { programId: true, topicId: true },
  });
  if (!session) {
    return { pearls: 0, qaPairs: 0, sjtCases: 0, pblScenarios: 0, skipped: true, reason: 'session-not-found' };
  }

  // Idempotency — skip if a pack was already generated for this transcript.
  const existingCount = await db.postSessionQa.count({
    where: { sessionTranscriptId: transcript.id },
  });
  if (existingCount > 0) {
    return { pearls: 0, qaPairs: 0, sjtCases: 0, pblScenarios: 0, skipped: true, reason: 'already-generated' };
  }

  const { contentText, id: transcriptId } = transcript;
  let pearlsCreated = 0;
  let qaCreated = 0;
  let sjtCreated = 0;
  let pblCreated = 0;

  if (contentText.length >= SHORT_TRANSCRIPT_THRESHOLD) {
    // ─── Long transcript: two-pass pipeline ────────────────────────────
    let chunks: TopicChunk[] = [];
    try {
      chunks = await segmentTranscript(contentText);
    } catch {
      // segmentation failure — fall through to short-path below
    }

    if (chunks.length > 0) {
      const digest = buildDigest(chunks);
      await Promise.allSettled([
        extractPearlsFromChunks(chunks, transcriptId, session.programId, session.topicId)
          .then((n) => { pearlsCreated = n; }),
        extractQaPairs(digest, transcriptId).then((n) => { qaCreated = n; }),
        generateSjt(digest, transcriptId).then((n) => { sjtCreated = n; }),
        generatePbl(digest, transcriptId).then((n) => { pblCreated = n; }),
      ]);
      return { pearls: pearlsCreated, qaPairs: qaCreated, sjtCases: sjtCreated, pblScenarios: pblCreated, skipped: false };
    }
  }

  // ─── Short transcript or segmentation fallback ──────────────────────
  const content = contentText.slice(-SHORT_TRANSCRIPT_THRESHOLD);
  await Promise.allSettled([
    extractPearlsDirect(content, transcriptId, session.programId, session.topicId)
      .then((n) => { pearlsCreated = n; }),
    extractQaPairs(content, transcriptId).then((n) => { qaCreated = n; }),
    generateSjt(content, transcriptId).then((n) => { sjtCreated = n; }),
    generatePbl(content, transcriptId).then((n) => { pblCreated = n; }),
  ]);

  return { pearls: pearlsCreated, qaPairs: qaCreated, sjtCases: sjtCreated, pblScenarios: pblCreated, skipped: false };
}

// ─── Segmentation (Gemini, Pass 1) ─────────────────────────────────────────

async function segmentTranscript(text: string): Promise<TopicChunk[]> {
  const chunks = await aiExtractFromSourceJson<TopicChunk[]>({
    systemPrompt: SEGMENT_PROMPT,
    parts: [{ text: `TRANSCRIPT:\n${text}` }],
    responseMimeType: 'application/json',
    temperature: 0.2,
  });
  if (!Array.isArray(chunks)) return [];
  return chunks.filter((c) => c.topicLabel && c.summary);
}

/** Condenses all topic chunks into a high-signal digest for Q&A / SJT / PBL. */
function buildDigest(chunks: TopicChunk[]): string {
  return chunks
    .map((c, i) =>
      `[Topic ${i + 1}: ${c.topicLabel}]\n${c.summary}` +
      (c.keyQuotes?.length
        ? `\nKey quotes:\n${c.keyQuotes.map((q) => `  - "${q}"`).join('\n')}`
        : ''),
    )
    .join('\n\n');
}

// ─── Pearl extraction — long path (per-chunk Opus → Sonnet dedup) ──────────

async function extractPearlsFromChunks(
  chunks: TopicChunk[],
  transcriptId: string,
  programId: string,
  topicId: string | null,
): Promise<number> {
  try {
    const candidates: RawPearl[] = [];
    for (let i = 0; i < chunks.length; i += MAX_PARALLEL_CHUNKS) {
      const batch = chunks.slice(i, i + MAX_PARALLEL_CHUNKS);
      const results = await Promise.allSettled(
        batch.map((chunk) =>
          aiEnhanceContentJson<RawPearl[]>({
            systemPrompt: PEARL_CHUNK_PROMPT,
            userMessage:
              `[Topic: ${chunk.topicLabel}]\n${chunk.summary}\n\n` +
              (chunk.keyQuotes?.length
                ? `Key quotes:\n${chunk.keyQuotes.map((q) => `- "${q}"`).join('\n')}`
                : ''),
            jsonOutput: true,
            temperature: 0.3,
            maxTokens: 1024,
          }),
        ),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          candidates.push(...r.value.filter((p) => p.title && p.body));
        }
      }
    }
    if (candidates.length === 0) return 0;

    // Sonnet dedup + rank → final 3
    const final = await aiDesignJson<RawPearl[]>({
      systemPrompt: PEARL_DEDUP_PROMPT,
      userMessage: `Pearl candidates:\n${JSON.stringify(candidates, null, 2)}`,
      jsonOutput: true,
      temperature: 0.2,
      maxTokens: 1024,
    });
    if (!Array.isArray(final)) return 0;
    const valid = final.slice(0, 3).filter((p) => p.title && p.body);
    return persistPearls(valid, transcriptId, programId, topicId);
  } catch (err) {
    if (!(err instanceof AiUnavailableError) && !(err instanceof AiUnparseableError)) {
      console.error('[post-session-pack] pearls-from-chunks failed', err);
    }
    return 0;
  }
}

// ─── Pearl extraction — short / fallback path ──────────────────────────────

async function extractPearlsDirect(
  content: string,
  transcriptId: string,
  programId: string,
  topicId: string | null,
): Promise<number> {
  try {
    const parsed = await aiEnhanceContentJson<RawPearl[]>({
      systemPrompt: PEARL_PROMPT_SHORT,
      userMessage: `TRANSCRIPT:\n${content}`,
      jsonOutput: true,
      temperature: 0.3,
      maxTokens: 1024,
    });
    if (!Array.isArray(parsed)) return 0;
    const valid = parsed.slice(0, 3).filter((p) => p.title && p.body);
    return persistPearls(valid, transcriptId, programId, topicId);
  } catch (err) {
    if (!(err instanceof AiUnavailableError) && !(err instanceof AiUnparseableError)) {
      console.error('[post-session-pack] pearls-direct failed', err);
    }
    return 0;
  }
}

// ─── Pearl persistence (shared) ────────────────────────────────────────────

async function persistPearls(
  pearls: RawPearl[],
  transcriptId: string,
  programId: string,
  topicId: string | null,
): Promise<number> {
  for (const p of pearls) {
    await db.pearl.create({
      data: {
        title: p.title.slice(0, 120),
        body: p.body.slice(0, 500),
        programId,
        topicId: topicId ?? null,
        sourceType: 'session_transcript',
        sourceSessionTranscriptId: transcriptId,
        extractedByAi: true,
        approved: false,
      },
    });
  }
  return pearls.length;
}

// ─── Q&A extraction ─────────────────────────────────────────────────────────

async function extractQaPairs(content: string, transcriptId: string): Promise<number> {
  try {
    const parsed = await aiEnhanceContentJson<RawQa[]>({
      systemPrompt: QA_PROMPT,
      userMessage: `SESSION CONTENT:\n${content}`,
      jsonOutput: true,
      temperature: 0.3,
      maxTokens: 2048,
    });
    if (!Array.isArray(parsed)) return 0;
    const valid = parsed.slice(0, 5).filter((q) => q.question && q.answer);
    for (const q of valid) {
      await db.postSessionQa.create({
        data: {
          sessionTranscriptId: transcriptId,
          question: q.question.slice(0, 500),
          answer: q.answer.slice(0, 1000),
          source: 'claude',
        },
      });
    }
    return valid.length;
  } catch (err) {
    if (!(err instanceof AiUnavailableError) && !(err instanceof AiUnparseableError)) {
      console.error('[post-session-pack] qa failed', err);
    }
    return 0;
  }
}

// ─── SJT generation ─────────────────────────────────────────────────────────

async function generateSjt(content: string, transcriptId: string): Promise<number> {
  try {
    const parsed = await aiEnhanceContentJson<RawSjt>({
      systemPrompt: SJT_PROMPT,
      userMessage: `SESSION CONTENT:\n${content}`,
      jsonOutput: true,
      temperature: 0.3,
      maxTokens: 1024,
    });
    if (!parsed?.stem) return 0;
    const options = Array.isArray(parsed.options) ? parsed.options.slice(0, 4) : [];
    const correctIndex = typeof parsed.correctIndex === 'number' ? parsed.correctIndex : null;
    await db.sjtCase.create({
      data: {
        sessionTranscriptId: transcriptId,
        stem: parsed.stem.slice(0, 2000),
        options,
        correctIndex,
        rationale: (parsed.rationale ?? '').slice(0, 1000),
        createdByAi: true,
        approved: false,
      },
    });
    return 1;
  } catch (err) {
    if (!(err instanceof AiUnavailableError) && !(err instanceof AiUnparseableError)) {
      console.error('[post-session-pack] sjt failed', err);
    }
    return 0;
  }
}

// ─── PBL generation ─────────────────────────────────────────────────────────

async function generatePbl(content: string, transcriptId: string): Promise<number> {
  try {
    const parsed = await aiEnhanceContentJson<RawPbl>({
      systemPrompt: PBL_PROMPT,
      userMessage: `SESSION CONTENT:\n${content}`,
      jsonOutput: true,
      temperature: 0.3,
      maxTokens: 1024,
    });
    if (!parsed?.trigger) return 0;
    const objectives = Array.isArray(parsed.objectives) ? parsed.objectives.slice(0, 5) : [];
    await db.pblScenario.create({
      data: {
        sessionTranscriptId: transcriptId,
        trigger: parsed.trigger.slice(0, 1000),
        objectives,
        content: (parsed.content ?? '').slice(0, 3000),
        createdByAi: true,
        approved: false,
      },
    });
    return 1;
  } catch (err) {
    if (!(err instanceof AiUnavailableError) && !(err instanceof AiUnparseableError)) {
      console.error('[post-session-pack] pbl failed', err);
    }
    return 0;
  }
}

// ─── Read helpers (used by the GET /post-session route) ────────────────────

export async function readPostSessionPack(sessionId: string) {
  const transcript = await db.sessionTranscript.findUnique({
    where: { sessionId_language: { sessionId, language: 'en' } },
    select: { id: true, finalized: true, finalizedAt: true },
  });
  if (!transcript) return null;

  const [pearls, qaPairs, sjtCases, pblScenarios] = await Promise.all([
    db.pearl.findMany({
      where: { sourceSessionTranscriptId: transcript.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, body: true, approved: true, createdAt: true },
    }),
    db.postSessionQa.findMany({
      where: { sessionTranscriptId: transcript.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, question: true, answer: true, createdAt: true },
    }),
    db.sjtCase.findMany({
      where: { sessionTranscriptId: transcript.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, stem: true, options: true, correctIndex: true, rationale: true, createdAt: true },
    }),
    db.pblScenario.findMany({
      where: { sessionTranscriptId: transcript.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, trigger: true, objectives: true, content: true, createdAt: true },
    }),
  ]);

  return {
    transcriptId: transcript.id,
    finalized: transcript.finalized,
    finalizedAt: transcript.finalizedAt?.toISOString() ?? null,
    pearls: pearls.map((p) => ({ id: p.id, title: p.title, body: p.body, approved: p.approved, createdAt: p.createdAt })),
    qaPairs: qaPairs.map((q) => ({ id: q.id, question: q.question, answer: q.answer, createdAt: q.createdAt })),
    sjtCases: sjtCases.map((s) => ({ id: s.id, stem: s.stem, options: s.options, correctIndex: s.correctIndex, rationale: s.rationale, createdAt: s.createdAt })),
    pblScenarios: pblScenarios.map((p) => ({ id: p.id, trigger: p.trigger, objectives: p.objectives, content: p.content, createdAt: p.createdAt })),
  };
}

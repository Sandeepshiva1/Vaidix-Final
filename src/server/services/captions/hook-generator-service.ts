// ════════════════════════════════════════════════════════════════════════════
// AI Hook Auto-Generator
// ════════════════════════════════════════════════════════════════════════════
// Every 15 minutes during a LIVE session this service reads the rolling
// SessionTranscript window and calls Gemini to generate 2 engagement hooks
// (one TRUE_FALSE or POLL, one DILEMMA or ONE_WORD or REPEAT_CONCEPT).
// Hooks are created and immediately fired so learners see them in HookOverlay.
//
// Scheduling: BullMQ AI_HOOK queue with delayed jobs (jobId dedupe prevents
// double-scheduling). The worker reschedules the next round after each run.

import { LiveHookKind } from '@prisma/client';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { getQueue, QUEUES } from '@/lib/queue';
import { geminiGenerate, tryParseJson, GeminiUnavailableError } from '@/server/services/ai/gemini';
import { createHook, fireHook } from '@/server/services/hooks/hooks-service';
import { loadPrompt } from '@/server/prompts/loader';

const ROUND_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_NEW_CHARS = 300;                  // skip round if transcript grew < 300 chars
const MAX_WINDOW_CHARS = 3_500;             // cap Gemini input per round
const OFFSET_TTL_SEC = 4 * 60 * 60;        // 4 h Redis TTL for offset key
const MAX_HOOKS_PER_ROUND = 2;             // never fire more than this in one round
const ANTI_REPEAT_LOOKBACK = 30;           // # of prior fired prompts fed back as "don't repeat"

interface GeminiHook {
  kind: string;
  prompt: string;
  options?: string[];
  correctOption?: string;
  explanation?: string;
}

/**
 * Normalise a hook prompt for duplicate detection: lowercase, strip punctuation
 * to spaces, collapse whitespace. Two prompts that differ only in casing /
 * punctuation / spacing collapse to the same key, so a regenerated near-verbatim
 * question is recognised as a repeat. Intentionally simple + deterministic
 * (no fuzzy matching) so behaviour is predictable and testable.
 */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Context fed to Gemini so generated hooks are anchored to THIS session — its
 * topic, the speaker's objectives, the shared material, and the live discussion —
 * instead of the transcript window alone (which produced generic, repeating
 * questions). `priorPrompts` is the recent fired-hook history used both to tell
 * the model "don't repeat these" and for server-side dedup after generation.
 */
interface HookGenContext {
  topicLine: string | null;
  objectives: string[];
  materialLines: string[];
  priorPrompts: string[];
}

async function loadHookGenContext(sessionId: string): Promise<HookGenContext> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { title: true, topicId: true, objectives: true },
  });

  let topicLine: string | null = session?.title ? `Session: ${session.title}` : null;
  if (session?.topicId) {
    const topic = await db.topic.findUnique({
      where: { id: session.topicId },
      select: { name: true, description: true },
    });
    if (topic) {
      topicLine = `Topic: ${topic.name}${topic.description ? ` — ${topic.description}` : ''}` +
        (session.title ? ` (session: ${session.title})` : '');
    }
  }

  const objectives = Array.isArray(session?.objectives)
    ? (session!.objectives as Array<{ text?: unknown }>)
        .map((o) => (typeof o?.text === 'string' ? o.text : null))
        .filter((t): t is string => !!t)
        .slice(0, 10)
    : [];

  // Shared study material — titles + descriptions give the model topical anchors
  // (and let it reference "the material") cheaply. We deliberately do NOT inline
  // full documents every round: a 15-min cadence makes that slow/expensive, and
  // the transcript already carries what's actually being discussed. (Pre-session
  // suggest-polls inlines full docs once; live grounding leans on the transcript.)
  const links = await db.documentSessionLink.findMany({
    where: { sessionId, isPreSession: true, document: { deletedAt: null } },
    orderBy: { preSessionRank: 'asc' },
    take: 12,
    select: { document: { select: { title: true, description: true } } },
  });
  const materialLines = links
    .map((l) => l.document)
    .filter((d): d is { title: string; description: string | null } => !!d)
    .map((d) => `- ${d.title}${d.description ? `: ${d.description.slice(0, 160)}` : ''}`);

  // Recent fired hooks — the anti-repeat list. Drives both the prompt instruction
  // and the post-generation dedup below.
  const prior = await db.liveHook.findMany({
    where: { sessionId, firedAt: { not: null } },
    orderBy: { firedAt: 'desc' },
    take: ANTI_REPEAT_LOOKBACK,
    select: { prompt: true },
  });
  const priorPrompts = prior.map((p) => p.prompt);

  return { topicLine, objectives, materialLines, priorPrompts };
}

/** Build the user-content text block fed to Gemini alongside the system prompt. */
function buildHookUserText(ctx: HookGenContext, transcriptWindow: string): string {
  const sections: string[] = [];
  if (ctx.topicLine) sections.push(ctx.topicLine);
  if (ctx.objectives.length > 0) {
    sections.push(
      `LEARNING OBJECTIVES:\n${ctx.objectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}`,
    );
  }
  if (ctx.materialLines.length > 0) {
    sections.push(`SHARED MATERIAL:\n${ctx.materialLines.join('\n')}`);
  }
  if (ctx.priorPrompts.length > 0) {
    sections.push(
      `ALREADY ASKED (do NOT repeat these or trivial rewordings):\n` +
        ctx.priorPrompts.map((p) => `- ${p}`).join('\n'),
    );
  }
  sections.push(`LIVE TRANSCRIPT (most recent discussion):\n${transcriptWindow}`);
  return sections.join('\n\n');
}

const VALID_KINDS = new Set<string>([
  'TRUE_FALSE',
  'POLL',
  'ONE_WORD',
  'REPEAT_CONCEPT',
  'DILEMMA',
]);

// System prompt is loaded from src/server/prompts/_base/op-hook-generator.md
// at call time. The loader interpolates {{DOMAIN_*}} placeholders so the same
// prompt works for ophthalmology today, cardiology tomorrow.

// ─── Public API ────────────────────────────────────────────────────────────

export interface AiHookJobData {
  sessionId: string;
  round: number;
}

/** Enqueue the very first round for a session — idempotent. */
export async function scheduleFirstHookRound(sessionId: string): Promise<void> {
  const jobId = `ahg-${sessionId}-r0`;
  const existing = await getQueue(QUEUES.AI_HOOK).getJob(jobId);
  if (existing) return;
  await getQueue(QUEUES.AI_HOOK).add(
    'ai-hook-generator',
    { sessionId, round: 0 } satisfies AiHookJobData,
    {
      jobId,
      delay: ROUND_INTERVAL_MS,
      attempts: 2,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: { age: 2 * 60 * 60, count: 500 },
      removeOnFail: { age: 24 * 60 * 60 },
    },
  );
}

/** Enqueue the next round — called by the worker after each completed round. */
export async function scheduleNextHookRound(sessionId: string, round: number): Promise<void> {
  const next = round + 1;
  const jobId = `ahg-${sessionId}-r${next}`;
  const existing = await getQueue(QUEUES.AI_HOOK).getJob(jobId);
  if (existing) return;
  await getQueue(QUEUES.AI_HOOK).add(
    'ai-hook-generator',
    { sessionId, round: next } satisfies AiHookJobData,
    {
      jobId,
      delay: ROUND_INTERVAL_MS,
      attempts: 2,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: { age: 2 * 60 * 60, count: 500 },
      removeOnFail: { age: 24 * 60 * 60 },
    },
  );
}

/** Core logic: read transcript window → Gemini → createHook + fireHook. */
export async function generateAndFireHooks(
  sessionId: string,
): Promise<{ hooksCreated: number; skipped: boolean; reason?: string; duplicatesSkipped?: number }> {
  // 1. Verify session is still LIVE and has a host.
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, status: true },
  });
  if (!session || session.status !== 'LIVE') {
    return { hooksCreated: 0, skipped: true, reason: 'session-not-live' };
  }

  // 2. Read the English transcript (Phase 1 only produces 'en').
  const transcript = await db.sessionTranscript.findUnique({
    where: { sessionId_language: { sessionId, language: 'en' } },
    select: { contentText: true, finalized: true },
  });
  if (!transcript?.contentText) {
    return { hooksCreated: 0, skipped: true, reason: 'no-transcript' };
  }

  // 3. Check how much new content arrived since last analysis.
  const offsetKey = `auto-hook:offset:${sessionId}`;
  const lastOffsetStr = await redis.get(offsetKey);
  const lastOffset = lastOffsetStr ? parseInt(lastOffsetStr, 10) : 0;
  const currentLen = transcript.contentText.length;

  if (currentLen - lastOffset < MIN_NEW_CHARS) {
    return { hooksCreated: 0, skipped: true, reason: 'insufficient-new-content' };
  }

  // 4. Extract window for Gemini (up to MAX_WINDOW_CHARS of new content).
  const windowStart = Math.max(0, currentLen - MAX_WINDOW_CHARS);
  const window = transcript.contentText.slice(windowStart, currentLen);

  // 4b. Load session grounding context (topic, objectives, material, anti-repeat
  // history) so hooks are relevant to THIS session and don't repeat.
  const ctx = await loadHookGenContext(sessionId);

  // 5. Call Gemini with the loaded + domain-interpolated system prompt, grounding
  // the transcript window in the session context.
  const prompt = await loadPrompt('op-hook-generator');
  let hooks: GeminiHook[];
  try {
    const raw = await geminiGenerate({
      systemInstruction: prompt.text,
      userParts: [{ text: buildHookUserText(ctx, window) }],
      responseMimeType: 'application/json',
      temperature: 0.4,
    });
    const parsed = tryParseJson<unknown>(raw);
    hooks = Array.isArray(parsed)
      ? (parsed as GeminiHook[]).slice(0, MAX_HOOKS_PER_ROUND)
      : [];
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return { hooksCreated: 0, skipped: true, reason: 'gemini-unavailable' };
    }
    throw err;
  }

  // 6. Create + fire each valid hook, skipping repeats. `seen` starts from the
  // session's prior fired prompts so a regenerated question that the model
  // produced despite the "already asked" instruction is still dropped here
  // (defence-in-depth dedup), and also dedupes within this batch.
  const seen = new Set(ctx.priorPrompts.map(normalizePrompt));
  let hooksCreated = 0;
  let duplicatesSkipped = 0;
  for (const h of hooks) {
    if (hooksCreated >= MAX_HOOKS_PER_ROUND) break;
    if (!VALID_KINDS.has(h.kind)) continue;
    if (!h.prompt || h.prompt.length > 500) continue;
    const finalPrompt = h.prompt.slice(0, 200);
    const key = normalizePrompt(finalPrompt);
    if (!key || seen.has(key)) {
      duplicatesSkipped++;
      continue;
    }
    seen.add(key);
    try {
      const { id } = await createHook({
        sessionId,
        createdById: session.hostId,
        kind: h.kind as LiveHookKind,
        prompt: finalPrompt,
        options: Array.isArray(h.options) ? h.options.slice(0, 4) : undefined,
        correctOption: h.correctOption,
        explanation: h.explanation?.slice(0, 500),
        autoGenerated: true,
      });
      await fireHook(id, session.hostId);
      hooksCreated++;
    } catch {
      // best-effort: one bad hook shouldn't abort the batch
    }
  }

  // 7. Persist new offset so next round only analyses fresh content.
  await redis.set(offsetKey, currentLen.toString(), 'EX', OFFSET_TTL_SEC);

  return { hooksCreated, skipped: false, duplicatesSkipped };
}

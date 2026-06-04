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

interface GeminiHook {
  kind: string;
  prompt: string;
  options?: string[];
  correctOption?: string;
  explanation?: string;
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
): Promise<{ hooksCreated: number; skipped: boolean; reason?: string }> {
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

  // 5. Call Gemini with the loaded + domain-interpolated system prompt.
  const prompt = await loadPrompt('op-hook-generator');
  let hooks: GeminiHook[];
  try {
    const raw = await geminiGenerate({
      systemInstruction: prompt.text,
      userParts: [{ text: `TRANSCRIPT:\n${window}` }],
      responseMimeType: 'application/json',
      temperature: 0.4,
    });
    const parsed = tryParseJson<unknown>(raw);
    hooks = Array.isArray(parsed)
      ? (parsed as GeminiHook[]).slice(0, 2)
      : [];
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return { hooksCreated: 0, skipped: true, reason: 'gemini-unavailable' };
    }
    throw err;
  }

  // 6. Create + fire each valid hook.
  let hooksCreated = 0;
  for (const h of hooks) {
    if (!VALID_KINDS.has(h.kind)) continue;
    if (!h.prompt || h.prompt.length > 500) continue;
    try {
      const { id } = await createHook({
        sessionId,
        createdById: session.hostId,
        kind: h.kind as LiveHookKind,
        prompt: h.prompt.slice(0, 200),
        options: Array.isArray(h.options) ? h.options.slice(0, 4) : undefined,
        correctOption: h.correctOption,
        explanation: h.explanation?.slice(0, 500),
      });
      await fireHook(id, session.hostId);
      hooksCreated++;
    } catch {
      // best-effort: one bad hook shouldn't abort the batch
    }
  }

  // 7. Persist new offset so next round only analyses fresh content.
  await redis.set(offsetKey, currentLen.toString(), 'EX', OFFSET_TTL_SEC);

  return { hooksCreated, skipped: false };
}

// ════════════════════════════════════════════════════════════════════════════
// AI Hook Generator Worker — W8.1
// ════════════════════════════════════════════════════════════════════════════
// Processes 'ai-hook-generator' jobs from the AI_HOOK queue.
// Each job reads the live session transcript, calls Gemini, creates + fires
// up to 2 hooks, then re-schedules the next round if the session is still LIVE.

import { createWorker, QUEUES } from '@/lib/queue';
import { db } from '@/lib/db';
import {
  generateAndFireHooks,
  scheduleNextHookRound,
  type AiHookJobData,
} from '@/server/services/captions/hook-generator-service';
import { log } from '@/lib/log';

export function startAiHookGeneratorWorker() {
  const worker = createWorker<AiHookJobData>(
    QUEUES.AI_HOOK,
    async (job) => {
      const { sessionId, round } = job.data;

      const result = await generateAndFireHooks(sessionId);

      log.info(
        { sessionId, round, ...result },
        '[ai-hook-generator] round complete',
      );

      // Re-schedule only if the session is still LIVE.
      const session = await db.teachingSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      if (session?.status === 'LIVE') {
        await scheduleNextHookRound(sessionId, round);
      }

      return result;
    },
    { concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    log.error(
      { id: job?.id, data: job?.data, err: err.message },
      '[ai-hook-generator] job failed',
    );
  });

  worker.on('completed', (job) => {
    log.info({ id: job.id, sessionId: job.data.sessionId, round: job.data.round }, '[ai-hook-generator] done');
  });

  return worker;
}

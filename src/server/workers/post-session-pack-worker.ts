// ════════════════════════════════════════════════════════════════════════════
// Post-Session Pack Worker — W8.3
// ════════════════════════════════════════════════════════════════════════════
// Processes 'post-session-pack' jobs from the POST_SESSION queue.
// Triggered automatically when a transcript is finalized (finalizeOnEnd=true).
// Generates Pearls, Q&A pairs, SJT case, and PBL scenario via Claude.

import { createWorker, QUEUES } from '@/lib/queue';
import { generatePostSessionPack } from '@/server/services/captions/post-session-pack-service';
import { log } from '@/lib/log';

export interface PostSessionJobData {
  sessionId: string;
}

export function startPostSessionPackWorker() {
  const worker = createWorker<PostSessionJobData>(
    QUEUES.POST_SESSION,
    async (job) => {
      const { sessionId } = job.data;
      const result = await generatePostSessionPack(sessionId);
      log.info({ sessionId, ...result }, '[post-session-pack] generation complete');
      return result;
    },
    { concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    log.error(
      { id: job?.id, sessionId: job?.data?.sessionId, err: err.message },
      '[post-session-pack] job failed',
    );
  });

  worker.on('completed', (job) => {
    log.info({ id: job.id, sessionId: job.data.sessionId }, '[post-session-pack] done');
  });

  return worker;
}

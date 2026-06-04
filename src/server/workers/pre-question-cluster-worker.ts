// ════════════════════════════════════════════════════════════════════════════
// Pre-Question Cluster Worker — W6 (Feeddback #2)
// ════════════════════════════════════════════════════════════════════════════
// Drains the `pre-question-cluster` BullMQ queue. Jobs are debounced by
// jobId=sessionId — the producer (pre-questions-service.scheduleRecluster)
// removes any delayed job with the same id before re-adding, so a burst of
// submissions collapses to a single worker invocation.
//
// On failure: BullMQ retries with exponential backoff per the global queue
// defaults. After exhausting attempts, the audit event PRE_QUESTION_CLUSTER_FAILED
// is already written by runClusterJob; the queue stops retrying on its own.

import { createWorker, QUEUES } from '@/lib/queue';
import {
  runClusterJob,
  type PreQuestionClusterJobData,
} from '@/server/services/pre-questions/pre-questions-service';

export function startPreQuestionClusterWorker() {
  const worker = createWorker<PreQuestionClusterJobData>(
    QUEUES.PRE_QUESTION_CLUSTER,
    async (job) => {
      const { sessionId } = job.data;
      const result = await runClusterJob(sessionId);
      return { sessionId, ...result, ranAt: new Date().toISOString() };
    },
    { concurrency: 2 }
  );

  worker.on('failed', (job, err) => {
    console.error('[pre-question-cluster] job failed', {
      id: job?.id,
      data: job?.data,
      attempts: job?.attemptsMade,
      err: err.message,
    });
  });
  worker.on('completed', (job, ret) => {
    console.log('[pre-question-cluster] clustered', { id: job.id, ret });
  });

  return worker;
}

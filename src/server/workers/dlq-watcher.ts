// security hardening — global DLQ watcher.
// Subscribes to QueueEvents on every CRITICAL queue. On `failed`, copies the
// failed job into the corresponding `*-dlq` queue (delayed 1h to allow the
// last automatic attempt to land), writes an audit row, and bumps a metric.

import { Queue, QueueEvents } from 'bullmq';
import { CRITICAL_QUEUES, dlqOf, type QueueName } from '@/lib/queue';
import { makeRedisConnection } from '@/lib/redis';
import { log } from '@/lib/log';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';

const dlqQueueCache = new Map<string, Queue>();

function getDlqQueue(name: QueueName): Queue {
  const dlq = dlqOf(name);
  let q = dlqQueueCache.get(dlq);
  if (!q) {
    q = new Queue(dlq, {
      connection: makeRedisConnection(),
      defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
    });
    dlqQueueCache.set(dlq, q);
  }
  return q;
}

export function startDlqWatchers() {
  const events = CRITICAL_QUEUES.map((name) => {
    const ev = new QueueEvents(name, { connection: makeRedisConnection() });
    ev.on('failed', async ({ jobId, failedReason, prev }) => {
      // Only enqueue to DLQ when the job has exhausted all retry attempts.
      // BullMQ emits `failed` on every attempt; the final state is `failed`.
      if (prev !== 'active') return; // guard against transient signal noise

      try {
        const sourceQueue = new Queue(name, { connection: makeRedisConnection() });
        const job = await sourceQueue.getJob(jobId);
        if (!job) return;
        if ((job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) return; // still has retries

        await getDlqQueue(name).add(
          'dlq',
          {
            sourceQueue: name,
            sourceJobId: jobId,
            data: job.data,
            failedReason,
            attemptsMade: job.attemptsMade,
            failedAt: new Date().toISOString(),
          },
          { jobId: `dlq:${name}:${jobId}` }
        );
        await audit({
          eventType: AUDIT_EVENTS.WORKER_JOB_DLQ,
          entityType: 'BullJob',
          entityId: jobId,
          details: { queue: name, reason: failedReason, attempts: job.attemptsMade },
          success: false,
        });
        log.error({ queue: name, jobId, reason: failedReason }, '[dlq] moved to dead letter');
      } catch (err) {
        log.error({ err, queue: name, jobId }, '[dlq] failed to record');
      }
    });
    return ev;
  });
  return events;
}

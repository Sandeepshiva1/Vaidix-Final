// ════════════════════════════════════════════════════════════════════════════
// BullMQ Queues + Worker Factory
// ════════════════════════════════════════════════════════════════════════════
// Queues handle async work: recording pipeline, transcription, email sends,
// Deck Forge jobs, expunge cascades, safety escalation notifications.

import { Queue, Worker, QueueEvents, type Processor } from 'bullmq';
import { makeRedisConnection } from './redis';

export const QUEUES = {
  RECORDING: 'recording-pipeline',
  TRANSCRIBE: 'transcription',
  AI_PROCESS: 'ai-processing',
  DECK_FORGE: 'deck-forge',
  EMAIL: 'email',
  EXPUNGE: 'expunge',
  RAG_INDEX: 'rag-index',
  SAFETY: 'safety-escalation',
  WEBHOOK: 'webhook-delivery',
  REMINDER: 'session-reminder',
  PRE_QUESTION_CLUSTER: 'pre-question-cluster',
  PHI_SCAN: 'phi-scan',
  // Promo teaser video render (own queue so no co-tenant skipping)
  PROMO: 'promo-pipeline',
  // AI hook auto-generator (15-min cadence per live session)
  AI_HOOK: 'ai-hook',
  // Post-session content pack (Pearl + QA + SJT + PBL via Claude)
  POST_SESSION: 'post-session',
  // security hardening
  AUDIT_WRITE: 'audit-write',
  // security hardening
  RETENTION: 'retention',
  // security hardening — DSR / DPDPA
  DSR_EXPORT: 'dsr-export',
  ERASURE: 'erasure',
} as const;

export type QueueName = typeof QUEUES[keyof typeof QUEUES];

// security hardening — DLQ queues for jobs that must not silently drop.
// Use `dlqOf(QUEUES.X)` to get the dlq queue for kind X. The worker for X
// moves its failed jobs into the DLQ via the `failed` event handler.
export function dlqOf(name: QueueName): string {
  return `${name}-dlq`;
}

/** Critical queues whose failures MUST surface in the admin failed-jobs view. */
export const CRITICAL_QUEUES: QueueName[] = [
  QUEUES.RECORDING,
  QUEUES.TRANSCRIBE,
  QUEUES.REMINDER,
  QUEUES.EMAIL,
  QUEUES.PHI_SCAN,
  QUEUES.AUDIT_WRITE,
  QUEUES.RETENTION,
  QUEUES.DSR_EXPORT,
  QUEUES.ERASURE,
];

const queueCache = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queueCache.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: makeRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  queueCache.set(name, queue);
  return queue;
}

export function createWorker<T = unknown, R = unknown>(
  name: QueueName,
  processor: Processor<T, R>,
  opts: { concurrency?: number } = {}
): Worker<T, R> {
  return new Worker<T, R>(name, processor, {
    connection: makeRedisConnection(),
    concurrency: opts.concurrency ?? 1,
  });
}

export function getQueueEvents(name: QueueName): QueueEvents {
  return new QueueEvents(name, { connection: makeRedisConnection() });
}

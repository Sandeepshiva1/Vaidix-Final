// HARDENING-PLAN.md item #8 — retry a DLQ job.
// POST body: { queue: 'recording-pipeline', dlqJobId: 'dlq:recording-pipeline:abc' }
// On success the DLQ job is removed and the source queue gets a new job.

import { z } from 'zod';
import { Queue } from 'bullmq';
import { Role } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { CRITICAL_QUEUES, dlqOf, type QueueName } from '@/lib/queue';
import { makeRedisConnection } from '@/lib/redis';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  queue: z.string(),
  dlqJobId: z.string(),
});

export async function POST(req: Request) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const { queue, dlqJobId } = body.data;
    if (!CRITICAL_QUEUES.includes(queue as QueueName)) {
      return jsonError('INVALID', 'Unknown queue', 400);
    }

    const dlq = new Queue(dlqOf(queue as QueueName), { connection: makeRedisConnection() });
    const source = new Queue(queue, { connection: makeRedisConnection() });
    try {
      const dlqJob = await dlq.getJob(dlqJobId);
      if (!dlqJob) return jsonError('NOT_FOUND', 'DLQ job not found', 404);
      const original = (dlqJob.data as { data?: unknown })?.data;
      const newJob = await source.add('retry', original ?? dlqJob.data, {});
      await dlqJob.remove();
      await audit({
        actorId: gate.user.id,
        actorRole: gate.user.role,
        eventType: AUDIT_EVENTS.WORKER_JOB_RETRIED,
        entityType: 'BullJob',
        entityId: String(newJob.id),
        details: { queue, dlqJobId, newJobId: newJob.id },
      });
      return jsonOk({ retriedAs: newJob.id });
    } finally {
      await dlq.close();
      await source.close();
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}

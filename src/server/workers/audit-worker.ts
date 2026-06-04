// HARDENING-PLAN.md item #14 — durable audit-log writer.
// Queue path: app calls `audit()` → fails on direct write → enqueues here →
// worker retries with exponential backoff. Idempotency uses the BullMQ jobId
// (UUID minted at enqueue time) and an `audit_events.idempotencyKey` column.

import { createWorker, QUEUES } from '@/lib/queue';
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import type { Job } from 'bullmq';
import type { AuditInput } from '@/server/services/audit';

async function processAuditWrite(job: Job<AuditInput>) {
  const input = job.data;
  // Use the job id as idempotency key — duplicate retries become no-ops.
  const idempotencyKey = job.id;
  try {
    await db.auditEvent.upsert({
      where: { idempotencyKey: idempotencyKey ?? `legacy:${Date.now()}` },
      create: {
        idempotencyKey,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        eventType: input.eventType,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        details: input.details ? (input.details as object) : undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: input.success ?? true,
      },
      update: {}, // present row → already written, do nothing.
    });
  } catch (err) {
    log.error({ err, jobId: job.id, eventType: input.eventType }, '[audit-worker] write failed');
    throw err; // BullMQ will retry per attempts/backoff config.
  }
}

export function startAuditWorker() {
  const w = createWorker<AuditInput>(QUEUES.AUDIT_WRITE, processAuditWrite, {
    concurrency: 2,
  });
  w.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, '[audit-worker] job failed');
  });
  w.on('completed', (job) => {
    log.debug({ jobId: job.id }, '[audit-worker] wrote');
  });
  return w;
}

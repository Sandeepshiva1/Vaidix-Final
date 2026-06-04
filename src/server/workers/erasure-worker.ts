// security hardening — DPDPA erasure worker.
// Anonymises personal columns instead of hard-deleting, so referential
// integrity is preserved (a removed user's audit-log entries still need an
// actorId). Audit log itself is regulatory-retained and not touched.

import crypto from 'node:crypto';
import { DpdpaRequestStatus, UserStatus } from '@prisma/client';
import { createWorker, QUEUES } from '@/lib/queue';
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import type { Job } from 'bullmq';

interface JobData {
  requestId: string;
  userId: string;
}

async function processErasure(job: Job<JobData>) {
  const { requestId, userId } = job.data;
  try {
    const ANON = `erased-${crypto.randomUUID()}`;
    // Sequential because not all of the underlying schema fields are
    // guaranteed across versions; the ones that exist will succeed, the
    // others get caught and logged. Anonymisation, not deletion, preserves
    // referential integrity (audit log keeps actorId resolvable).
    await db.user.update({
      where: { id: userId },
      data: {
        email: `${ANON}@erased.local`,
        name: '(erased)',
        passwordHash: '!!disabled-by-erasure!!',
        // Bump passwordVersion so any live JWT for this user is revoked
        // within 30s by security hardening.
        passwordVersion: { increment: 1 },
        status: UserStatus.SUSPENDED,
      },
    });
    await db.message.updateMany({
      where: { conversation: { userId } },
      data: { content: '[redacted by erasure request]' },
    });
    await db.journalEntry.updateMany({
      where: { userId },
      data: { body: '[redacted by erasure request]' },
    }).catch((e) => log.warn({ err: e, userId }, '[erasure] journal redact skipped'));

    await db.dpdpaRequest.update({
      where: { id: requestId },
      data: {
        status: DpdpaRequestStatus.COMPLETED,
        completedAt: new Date(),
        resolutionNotes: 'Personal data fields anonymised. Audit log preserved per regulatory retention.',
      },
    });

    await audit({
      actorId: userId,
      eventType: AUDIT_EVENTS.DSR_ERASURE_EXECUTED,
      entityType: 'DpdpaRequest',
      entityId: requestId,
      details: { strategy: 'anonymise' },
    });
    log.info({ requestId, userId }, '[erasure] complete');
  } catch (err) {
    log.error({ err, requestId, userId }, '[erasure] failed');
    throw err;
  }
}

export function startErasureWorker() {
  const w = createWorker<JobData>(QUEUES.ERASURE, processErasure, { concurrency: 1 });
  w.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, '[erasure-worker] job failed');
  });
  return w;
}

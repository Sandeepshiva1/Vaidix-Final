// security hardening — daily retention sweep.
// Iterates `retention_policies`, applies each enabled policy. Strategy:
//   - purge:     delete rows older than ttlDays + remove S3 objects
//   - anonymise: replace identifying fields with placeholders, keep stats
// Runs as a BullMQ repeatable job; first registration is in workers/index.ts.
//
// IMPORTANT: this worker depends on the audit trigger from migration
// 20260425170000_audit_append_only — when it purges audit_events older than
// 7 years it MUST connect with a role that's a member of vaidix_audit_admins.
// In v1 we keep audit purge disabled-by-default (`enabled=false` is left for
// the operator to flip after legal review confirms the 7y window).

import { createWorker, getQueue, QUEUES } from '@/lib/queue';
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import type { Job } from 'bullmq';

const DAY_MS = 24 * 3600 * 1000;

interface SweepReport {
  kind: string;
  removed: number;
  errors: number;
}

async function sweepKind(
  kind: string,
  ttlDays: number,
  strategy: string
): Promise<SweepReport> {
  const cutoff = new Date(Date.now() - ttlDays * DAY_MS);
  let removed = 0;
  let errors = 0;
  try {
    switch (kind) {
      case 'ENGAGEMENT_SIGNAL': {
        const r = await db.engagementSignal.deleteMany({ where: { createdAt: { lt: cutoff } } });
        removed = r.count;
        break;
      }
      case 'RECORDING_SHARE': {
        // Hard-delete shares whose expiresAt is well past the TTL.
        const r = await db.recordingShare.deleteMany({
          where: { expiresAt: { lt: cutoff } },
        });
        removed = r.count;
        break;
      }
      case 'RECORDING_SHARE_ACCESS': {
        const r = await db.recordingShareAccess.deleteMany({ where: { accessedAt: { lt: cutoff } } });
        removed = r.count;
        break;
      }
      case 'CASE_CONVERSATION': {
        if (strategy === 'anonymise') {
          // Replace personal content but keep the row for analytics.
          const r = await db.message.updateMany({
            where: { createdAt: { lt: cutoff } },
            data: { content: '[redacted by retention policy]' },
          });
          removed = r.count;
        } else {
          const r = await db.conversation.deleteMany({ where: { createdAt: { lt: cutoff } } });
          removed = r.count;
        }
        break;
      }
      // Other kinds (RECORDING, TRANSCRIPT, AUDIT_EVENT, etc.) require
      // S3 lifecycle / DB-admin coordination — left as `enabled=false`
      // by default. Operator turns these on after legal review.
      default:
        log.info({ kind }, '[retention] no handler — skipping');
    }
  } catch (err) {
    errors++;
    log.error({ err, kind }, '[retention] sweep error');
  }
  return { kind, removed, errors };
}

async function processSweep(_job: Job) {
  const policies = await db.retentionPolicy.findMany({ where: { active: true } });
  const reports: SweepReport[] = [];
  for (const p of policies) {
    const r = await sweepKind(p.entityType, p.retentionDays, p.strategy);
    reports.push(r);
    await db.retentionPolicy.update({
      where: { id: p.id },
      data: { lastSweepAt: new Date() },
    });
    if (r.removed > 0) {
      await audit({
        eventType: AUDIT_EVENTS.RETENTION_RECORD_PURGED,
        entityType: 'RetentionPolicy',
        entityId: p.id,
        details: { kind: p.entityType, removed: r.removed, ttlDays: p.retentionDays },
      });
    }
  }
  await audit({
    eventType: AUDIT_EVENTS.RETENTION_SWEEP_RAN,
    details: { reports },
  });
  log.info({ reports }, '[retention] sweep complete');
  return { reports };
}

export function startRetentionWorker() {
  const w = createWorker(QUEUES.RETENTION, processSweep, { concurrency: 1 });
  // Register the daily repeatable job once on start. BullMQ dedupes by jobId.
  void getQueue(QUEUES.RETENTION).add(
    'daily',
    {},
    {
      jobId: 'retention:daily',
      repeat: { pattern: '0 3 * * *' /* 03:00 server time */ },
    }
  );
  return w;
}

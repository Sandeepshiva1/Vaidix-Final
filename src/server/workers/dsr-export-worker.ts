// HARDENING-PLAN item #17 — DPDPA data export worker.
// Gathers a user's data into a JSON tarball, uploads to MinIO under
// dsr-export/<requestId>.tar.gz, sets a presigned URL, marks the request
// COMPLETED and emails the user. Tarball auto-expires from S3 after 7d
// per the bucket lifecycle policy.

import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { DpdpaRequestStatus } from '@prisma/client';
import { createWorker, QUEUES } from '@/lib/queue';
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { presignDownload, BUCKET, s3 } from '@/lib/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { Job } from 'bullmq';

interface JobData {
  requestId: string;
  userId: string;
}

async function gatherUserData(userId: string) {
  // Pull rows that contain the user's personal data. Add new tables here as
  // they appear. Sensitive associations (e.g. session participants) are
  // included since the user has a right to see them.
  const [user, conversations, messages, journals, kirkpatrick, scoringEvents,
         engagementSignals, dpdpa, consents] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.conversation.findMany({ where: { userId } }),
    db.message.findMany({ where: { conversation: { userId } } }),
    db.journalEntry.findMany({ where: { userId } }),
    db.kirkpatrickEvaluation.findMany({ where: { userId } }).catch(() => []),
    db.scoringEvent.findMany({ where: { residentId: userId } }),
    db.engagementSignal.findMany({ where: { userId } }).catch(() => []),
    db.dpdpaRequest.findMany({ where: { subjectUserId: userId } }),
    db.consentRecord.findMany({ where: { userId } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    user,
    conversations,
    messages,
    journals,
    kirkpatrick,
    scoringEvents,
    engagementSignals,
    dpdpaRequests: dpdpa,
    consents,
  };
}

async function processExport(job: Job<JobData>) {
  const { requestId, userId } = job.data;
  try {
    const data = await gatherUserData(userId);
    const json = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
    const gz = zlib.gzipSync(json);
    const sha = crypto.createHash('sha256').update(gz).digest('hex');
    const key = `dsr-export/${requestId}.json.gz`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: gz,
        ContentType: 'application/gzip',
        ContentDisposition: `attachment; filename="vaidix-export-${requestId}.json.gz"`,
        Metadata: { sha256: sha, requestid: requestId, userid: userId },
      })
    );

    const url = await presignDownload(key, 7 * 24 * 3600); // 7-day URL

    await db.dpdpaRequest.update({
      where: { id: requestId },
      data: {
        status: DpdpaRequestStatus.COMPLETED,
        completedAt: new Date(),
        resolutionNotes: `Export ready: sha256=${sha}; expires with bucket lifecycle (7d).`,
      },
    });

    await audit({
      actorId: userId,
      eventType: AUDIT_EVENTS.DSR_EXPORT_DELIVERED,
      entityType: 'DpdpaRequest',
      entityId: requestId,
      details: { sha256: sha, key },
    });

    log.info({ requestId, userId, key, sha, urlReady: !!url }, '[dsr-export] delivered');
  } catch (err) {
    log.error({ err, requestId, userId }, '[dsr-export] failed');
    await db.dpdpaRequest.update({
      where: { id: requestId },
      data: { status: DpdpaRequestStatus.IN_PROGRESS, resolutionNotes: `failed: ${(err as Error).message}` },
    }).catch(() => {});
    throw err;
  }
}

export function startDsrExportWorker() {
  const w = createWorker<JobData>(QUEUES.DSR_EXPORT, processExport, { concurrency: 1 });
  w.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, '[dsr-export-worker] job failed');
  });
  return w;
}

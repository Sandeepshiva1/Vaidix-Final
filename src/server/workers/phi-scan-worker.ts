// ════════════════════════════════════════════════════════════════════════════
// PHI Scan Worker — fixes the Document gap (reviewer flagged this)
// ════════════════════════════════════════════════════════════════════════════
// Consumes PHI_SCAN queue jobs:
//   { documentId } → downloads document from MinIO, extracts text per mime,
//                    runs phi-scanner, persists PhiScanResult, updates
//                    Document.phiScanStatus + phiScanResult.
//
// If the scan blocks (high-severity entity detected), the document.status is
// flipped to PENDING_REVIEW and visibility kept PRIVATE_FACULTY. Faculty
// must explicitly approve from the UI before the document can be tagged to a
// session — see /api/documents/[id]/approve which now also requires a clean
// scan or an override flag.

import { db } from '@/lib/db';
import { createWorker, QUEUES } from '@/lib/queue';
import { presignDownload } from '@/lib/storage';
import { scanForPhi } from '@/server/services/phi/phi-scanner';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { DocumentKind, DocumentStatus } from '@prisma/client';

interface PhiScanJobData {
  documentId: string;
}

/** Best-effort text extraction. Plain text + markdown go through directly;
 * PDF/PPT/DOC require a parser we don't ship — for now we scan the raw
 * binary's printable-ASCII subset, which catches obvious phone/Aadhaar/email
 * patterns embedded in metadata or unencrypted streams. Real Presidio
 * sidecar will swap this with proper extraction. */
async function extractText(buf: Buffer, mimeType: string): Promise<string> {
  const isText = /^text\//i.test(mimeType) || /markdown|plain/i.test(mimeType);
  if (isText) return buf.toString('utf-8');
  // Heuristic: extract printable ASCII runs of length ≥ 4 from binary.
  const ascii: string[] = [];
  let run = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x20 && b <= 0x7e) {
      run += String.fromCharCode(b);
    } else {
      if (run.length >= 4) ascii.push(run);
      run = '';
    }
  }
  if (run.length >= 4) ascii.push(run);
  return ascii.join('\n');
}

async function scanDocumentJob(data: PhiScanJobData): Promise<{ documentId: string; severity: string; blocked: boolean; entityCount: number }> {
  const doc = await db.document.findUnique({
    where: { id: data.documentId },
    select: { id: true, s3Key: true, mimeType: true, kind: true, status: true, sizeBytes: true },
  });
  if (!doc) throw new Error(`Document ${data.documentId} not found`);
  // Skip pure media — image/video/audio scans need ML; out of scope for this stopgap.
  if (doc.kind === DocumentKind.IMAGE || doc.kind === DocumentKind.VIDEO || doc.kind === DocumentKind.AUDIO) {
    await db.document.update({
      where: { id: doc.id },
      data: { phiScanStatus: 'SKIPPED_MEDIA' },
    });
    return { documentId: doc.id, severity: 'low', blocked: false, entityCount: 0 };
  }

  // Cap text extraction at 5 MB — anything bigger is exotic for a teaching deck.
  const sizeBytes = Number(doc.sizeBytes ?? 0);
  if (sizeBytes > 5 * 1024 * 1024) {
    await db.document.update({
      where: { id: doc.id },
      data: { phiScanStatus: 'SKIPPED_TOO_LARGE' },
    });
    return { documentId: doc.id, severity: 'low', blocked: false, entityCount: 0 };
  }

  const url = await presignDownload(doc.s3Key, 600);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch document for PHI scan: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = await extractText(buf, doc.mimeType);

  const report = scanForPhi(text);

  // Persist a PhiScanResult row.
  await db.phiScanResult.create({
    data: {
      targetType: 'DOCUMENT',
      targetId: doc.id,
      detectedEntities: report.entities as unknown as object,
      severity: report.severity,
      blocked: report.blocked,
      scannerVersion: report.scannerVersion,
    },
  });

  // Update Document with summary + status.
  const newStatus = report.blocked ? DocumentStatus.PENDING_REVIEW : doc.status;
  await db.document.update({
    where: { id: doc.id },
    data: {
      phiScanStatus: report.blocked ? 'BLOCKED' : report.entities.length === 0 ? 'CLEAN' : 'FLAGGED',
      phiScanResult: {
        scannerVersion: report.scannerVersion,
        textLength: report.textLength,
        severity: report.severity,
        blocked: report.blocked,
        entityCount: report.entities.length,
        entityTypes: [...new Set(report.entities.map((e) => e.type))],
      } as unknown as object,
      status: newStatus,
    },
  });

  await audit({
    eventType: report.blocked ? AUDIT_EVENTS.DOCUMENT_DELETED : AUDIT_EVENTS.DOCUMENT_CLASSIFIED,
    entityType: 'Document',
    entityId: doc.id,
    summary: report.blocked
      ? `PHI scan blocked: ${report.entities.length} entity(ies); top severity ${report.severity}`
      : `PHI scan ${report.entities.length === 0 ? 'clean' : `flagged ${report.entities.length} entity(ies)`}`,
    details: {
      severity: report.severity,
      types: [...new Set(report.entities.map((e) => e.type))],
      scannerVersion: report.scannerVersion,
    },
    success: !report.blocked,
  });

  return {
    documentId: doc.id,
    severity: report.severity,
    blocked: report.blocked,
    entityCount: report.entities.length,
  };
}

export function startPhiScanWorker() {
  const worker = createWorker<PhiScanJobData>(
    QUEUES.PHI_SCAN,
    async (job) => scanDocumentJob(job.data),
    { concurrency: 2 }
  );
  worker.on('failed', async (job, err) => {
    console.error('[phi-scan-worker] job failed', { id: job?.id, err: err.message });
    if (job?.data?.documentId) {
      await db.document.update({
        where: { id: job.data.documentId },
        data: { phiScanStatus: 'FAILED' },
      }).catch(() => {});
    }
  });
  worker.on('completed', (job, result) => {
    console.log('[phi-scan-worker] done', { id: job.id, result });
  });
  return worker;
}

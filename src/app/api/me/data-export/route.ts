// HARDENING-PLAN item #17 — user-initiated data export (DPDPA / GDPR-style).
// POST creates a DpdpaRequest of kind EXPORT; an async dsr-export-worker
// gathers the user's data, uploads a tarball to s3://vaidix-video/dsr-export/,
// emails a time-limited presigned URL when ready.
// GET returns the user's outstanding requests so the UI can show progress.

import { DpdpaRequestStatus, DpdpaRequestType } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  requireAuth,
  requireCsrf,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getQueue, QUEUES } from '@/lib/queue';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const requests = await db.dpdpaRequest.findMany({
      where: { subjectUserId: gate.user.id, kind: DpdpaRequestType.EXPORT },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return jsonOk({ requests });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;

    // Throttle: one outstanding EXPORT request per user.
    const existing = await db.dpdpaRequest.findFirst({
      where: {
        subjectUserId: gate.user.id,
        kind: DpdpaRequestType.EXPORT,
        status: { in: [DpdpaRequestStatus.RECEIVED, DpdpaRequestStatus.IN_PROGRESS] },
      },
    });
    if (existing) {
      return jsonError(
        'ALREADY_PENDING',
        'You already have a pending data export. We will email you when it is ready.',
        409,
        { requestId: existing.id }
      );
    }

    const request = await db.dpdpaRequest.create({
      data: {
        subjectUserId: gate.user.id,
        kind: DpdpaRequestType.EXPORT,
        status: DpdpaRequestStatus.IN_PROGRESS, // EXPORT is auto-approved per DPDPA right
        targetSlaAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    await getQueue(QUEUES.DSR_EXPORT).add(
      'export',
      { requestId: request.id, userId: gate.user.id },
      { jobId: `dsr:${request.id}` }
    );

    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.DSR_EXPORT_REQUESTED,
      entityType: 'DpdpaRequest',
      entityId: request.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return jsonOk({ request }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

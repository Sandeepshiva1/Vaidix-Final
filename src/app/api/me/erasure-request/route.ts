// HARDENING-PLAN item #17 — user-initiated erasure request.
// POST creates a DpdpaRequest of kind ERASURE in RECEIVED status.
// An admin/PD must approve before any data is touched (legal hold cases).
// Audit log itself is preserved for the regulatory window — see RetentionPolicy.

import { z } from 'zod';
import { DpdpaRequestStatus, DpdpaRequestType } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireAuth,
  requireCsrf,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  reason: z.string().trim().min(10).max(2000),
});

export async function POST(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;

    const existing = await db.dpdpaRequest.findFirst({
      where: {
        subjectUserId: gate.user.id,
        kind: DpdpaRequestType.ERASURE,
        status: { in: [DpdpaRequestStatus.RECEIVED, DpdpaRequestStatus.IN_PROGRESS] },
      },
    });
    if (existing) {
      return jsonError(
        'ALREADY_PENDING',
        'You already have a pending erasure request awaiting review.',
        409,
        { requestId: existing.id }
      );
    }

    const request = await db.dpdpaRequest.create({
      data: {
        subjectUserId: gate.user.id,
        kind: DpdpaRequestType.ERASURE,
        status: DpdpaRequestStatus.RECEIVED,
        description: body.data.reason,
        // SLA: 30 days per DPDPA expectations.
        targetSlaAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.DSR_ERASURE_REQUESTED,
      entityType: 'DpdpaRequest',
      entityId: request.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return jsonOk(
      {
        request,
        message:
          'Your erasure request has been logged. An administrator will review it within 30 days as required by DPDPA. You will be notified by email of the decision.',
      },
      { status: 201 }
    );
  } catch (err) {
    return handleUnexpected(err);
  }
}

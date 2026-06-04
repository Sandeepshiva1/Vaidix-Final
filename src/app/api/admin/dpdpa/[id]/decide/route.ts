// security hardening — admin approves/rejects a DPDPA erasure request.
// POST { decision: 'APPROVE' | 'REJECT', notes?: string }
// On APPROVE: enqueues the ERASURE worker to scrub identifying fields.
// On REJECT: marks the request REJECTED with notes; user is emailed.

import { z } from 'zod';
import {
  Role,
  DpdpaRequestStatus,
  DpdpaRequestType,
} from '@prisma/client';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireRole,
  requireCsrf,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getQueue, QUEUES } from '@/lib/queue';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  notes: z.string().max(4000).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRole(Role.ADMIN, Role.PROGRAM_DIRECTOR);
    if (!gate.ok) return gate.response;
    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const { id } = await ctx.params;

    const request = await db.dpdpaRequest.findUnique({ where: { id } });
    if (!request) return jsonError('NOT_FOUND', 'Request not found', 404);
    if (request.kind !== DpdpaRequestType.ERASURE) {
      return jsonError('INVALID', 'Only ERASURE requests need a decision', 400);
    }
    if (request.status !== DpdpaRequestStatus.RECEIVED) {
      return jsonError('INVALID', `Request already ${request.status}`, 400);
    }

    const meta = extractRequestMetadata(req);

    if (body.data.decision === 'REJECT') {
      await db.dpdpaRequest.update({
        where: { id },
        data: {
          status: DpdpaRequestStatus.REJECTED,
          handledById: gate.user.id,
          resolutionNotes: body.data.notes,
          completedAt: new Date(),
        },
      });
      await audit({
        actorId: gate.user.id,
        actorRole: gate.user.role,
        eventType: AUDIT_EVENTS.DSR_ERASURE_APPROVED, // logged with success=false on reject
        entityType: 'DpdpaRequest',
        entityId: id,
        success: false,
        details: { decision: 'REJECT', notes: body.data.notes },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return jsonOk({ status: 'REJECTED' });
    }

    await db.dpdpaRequest.update({
      where: { id },
      data: {
        status: DpdpaRequestStatus.IN_PROGRESS,
        handledById: gate.user.id,
        resolutionNotes: body.data.notes,
      },
    });
    await getQueue(QUEUES.ERASURE).add(
      'erase',
      { requestId: id, userId: request.subjectUserId },
      { jobId: `erasure:${id}` }
    );
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.DSR_ERASURE_APPROVED,
      entityType: 'DpdpaRequest',
      entityId: id,
      details: { decision: 'APPROVE', notes: body.data.notes },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return jsonOk({ status: 'IN_PROGRESS' });
  } catch (err) {
    return handleUnexpected(err);
  }
}

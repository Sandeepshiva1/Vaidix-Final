// POST /api/notifications/whatsapp/send —  admin/test send.
// Body: { userId, pearlId } → looks up the pearl + sends one immediate WA pearl.
// Real-world cadence (24h/72h/7d) goes through schedule-pearls.

import { z } from 'zod';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { sendWhatsappPearl } from '@/server/services/whatsapp/whatsapp-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { isUserInProgram } from '@/server/services/program-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const schema = z.object({
  userId: z.string().min(1),
  pearlId: z.string().min(1),
});

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const rl = await checkRateLimit({ bucket: `wa-send:${auth.user.id}`, ...LIMITS.WHATSAPP_SEND });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'WhatsApp send throttled', 429, { resetAt: rl.resetAt.toISOString() });
  }

  // Tenant guard: the recipient must share the sender's active program — without
  // this a faculty member could message any user id in the institution.
  const recipientInProgram = auth.user.activeProgramId
    ? await isUserInProgram(body.data.userId, auth.user.activeProgramId)
    : false;
  if (!recipientInProgram) {
    return jsonError('FORBIDDEN', 'Recipient is not in your active program', 403);
  }

  try {
    const pearl = await db.pearl.findUnique({
      where: { id: body.data.pearlId },
      select: { id: true, title: true, body: true },
    });
    if (!pearl) return jsonError('NOT_FOUND', 'Pearl not found', 404);

    const result = await sendWhatsappPearl({
      userId: body.data.userId,
      templateKind: 'PEARL',
      payload: {
        pearlId: pearl.id,
        title: pearl.title,
        body: pearl.body.slice(0, 800),
        spacedDay: 1,
      },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: result.delivered ? AUDIT_EVENTS.WHATSAPP_PEARL_SENT : AUDIT_EVENTS.WHATSAPP_PEARL_BLOCKED,
      entityType: 'Notification',
      entityId: result.notification.id,
      summary: result.delivered ? 'WhatsApp pearl sent' : `WhatsApp pearl blocked: ${result.reason}`,
      details: { recipientUserId: body.data.userId, pearlId: pearl.id, reason: result.reason ?? null },
      success: result.delivered,
      ...extractRequestMetadata(req),
    });
    return jsonOk(result);
  } catch (err) {
    return handleUnexpected(err);
  }
}

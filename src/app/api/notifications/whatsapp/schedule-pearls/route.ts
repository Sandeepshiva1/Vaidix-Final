// POST /api/notifications/whatsapp/schedule-pearls
// Body: { userIds: string[], pearlIds: string[] }
// Schedules 24h/72h/7d delayed jobs per (userId × pearlId).

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
import { schedulePearlSpacedDelivery } from '@/server/services/whatsapp/whatsapp-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const schema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  pearlIds: z.array(z.string().min(1)).min(1).max(50),
});

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const rl = await checkRateLimit({ bucket: `wa-schedule:${auth.user.id}`, ...LIMITS.WHATSAPP_SCHEDULE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Schedule throttled', 429, { resetAt: rl.resetAt.toISOString() });
  }

  try {
    // only let the actor schedule pearls from a program they are
    // active in. Prevents a Cornea Fellowship faculty from scheduling MS
    // Ophthalmology pearls to MS residents.
    const u = await db.user.findUnique({
      where: { id: auth.user.id },
      select: { activeProgramId: true },
    });
    if (!u?.activeProgramId) {
      return jsonError('NO_ACTIVE_PROGRAM', 'No active program', 409);
    }
    const pearls = await db.pearl.findMany({
      where: { id: { in: body.data.pearlIds }, programId: u.activeProgramId },
      select: { id: true, title: true, body: true },
    });
    if (pearls.length === 0) return jsonError('NOT_FOUND', 'No matching pearls', 404);

    let scheduled = 0;
    const allJobIds: string[] = [];
    for (const userId of body.data.userIds) {
      for (const pearl of pearls) {
        const r = await schedulePearlSpacedDelivery({
          userId,
          pearl: {
            id: pearl.id,
            title: pearl.title,
            body: pearl.body.slice(0, 800),
          },
        });
        scheduled += r.scheduled;
        allJobIds.push(...r.jobIds);
      }
    }
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.WHATSAPP_PEARLS_SCHEDULED,
      entityType: 'WhatsappBatch',
      entityId: null,
      summary: `Scheduled ${scheduled} WhatsApp pearl jobs`,
      details: {
        userIdCount: body.data.userIds.length,
        pearlIdCount: body.data.pearlIds.length,
        scheduledCount: scheduled,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ scheduledCount: scheduled, jobIds: allJobIds });
  } catch (err) {
    return handleUnexpected(err);
  }
}

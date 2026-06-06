// POST /api/classroom/sessions/[id]/webinar-registrations/confirm
//   PUBLIC. Activates a webinar registration via the email confirmation
//   token. Side effects:
//     1. WebinarRegistration.confirmedAt = now
//     2. User auto-provisioned (status=ACTIVE, role=EXTERNAL_LEARNER) if no
//        row exists for this email
//     3. SessionInvite created (PARTICIPANT — token route demotes to VIEWER
//        for webinars based on isWebinar)
//
// Response is intentionally minimal to keep the public surface boring — no
// user IDs, no internal state. The next step the visitor takes is the
// session join URL emailed separately on the day of the event.

import { z } from 'zod';
import { Role, UserStatus, SessionInviteStatus } from '@prisma/client';
import { hashToken } from '@/server/services/tokens';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';

const writeSchema = z.object({
  token: z.string().min(16).max(64),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const body = await parseBody(req, writeSchema);
    if (!body.ok) return body.response;
    const { id: sessionId } = await ctx.params;

    const tokenHash = hashToken(body.data.token);
    const reg = await db.webinarRegistration.findUnique({
      where: { confirmTokenHash: tokenHash },
    });
    if (!reg || reg.sessionId !== sessionId) {
      return jsonError('NOT_FOUND', 'Invalid confirmation token', 404);
    }
    if (reg.confirmedAt) {
      return jsonOk({ alreadyConfirmed: true });
    }

    // webinar self-registrations create EXTERNAL_LEARNER accounts.
    // Land them in the session's program so they can see this session
    // (and only this session, until an admin grants other memberships).
    const sessionRow = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { programId: true },
    });
    if (!sessionRow) {
      return jsonError('NOT_FOUND', 'Session no longer exists', 404);
    }

    let user = await db.user.findUnique({ where: { email: reg.email } });
    if (!user) {
      user = await db.user.create({
        data: {
          email: reg.email,
          name: reg.name,
          role: Role.EXTERNAL_LEARNER,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          activeProgramId: sessionRow.programId,
        },
      });
    }
    // Idempotent membership upsert — user may have registered before.
    await db.programMembership.upsert({
      where:  { userId_programId: { userId: user.id, programId: sessionRow.programId } },
      update: {},
      create: { userId: user.id, programId: sessionRow.programId },
    });

    // Tx: link registration to user, mark confirmed, ensure invite exists.
    await db.$transaction([
      db.webinarRegistration.update({
        where: { id: reg.id },
        data: { confirmedAt: new Date(), userId: user.id },
      }),
      db.sessionInvite.upsert({
        where: { sessionId_userId: { sessionId, userId: user.id } },
        create: {
          sessionId,
          userId: user.id,
          status: SessionInviteStatus.INVITED,
          invitedBy: user.id, // self-registered; surrogate for system actor
        },
        update: {},
      }),
    ]);

    return jsonOk({ confirmed: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

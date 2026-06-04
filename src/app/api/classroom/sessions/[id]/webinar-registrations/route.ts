// POST /api/classroom/sessions/[id]/webinar-registrations
//   PUBLIC route — no auth required. A visitor on /webinar/[id]/register
//   submits name + email + consent and we create a WebinarRegistration row
//   in unconfirmed state. The confirmation link gets emailed (and surfaced
//   in the response for tests / dev). Confirming the link creates a
//   SessionInvite + auto-provisions a User row, granting VIEWER role at
//   token mint time.
//
// GET /api/classroom/sessions/[id]/webinar-registrations
//   HOST/CO_HOST only. Lists registrations for marketing / attendance.

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

const writeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(254),
  organisation: z.string().trim().max(200).optional(),
  roleTitle: z.string().trim().max(120).optional(),
  source: z.string().trim().max(80).optional(),
  consented: z.literal(true),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const body = await parseBody(req, writeSchema);
    if (!body.ok) return body.response;
    const { id: sessionId } = await ctx.params;

    // Rate-limit by IP+email so a leaked endpoint can't be used as a list
    // bombing weapon. Bucket also caps the spam rate to 5/hr per (IP+email).
    const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = fwd || req.headers.get('cf-connecting-ip') || 'unknown';
    const rl = await checkRateLimit({
      bucket: `webinar-reg:${ip}:${body.data.email.toLowerCase()}`,
      ...LIMITS.WEBINAR_REGISTER,
    });
    if (!rl.allowed) {
      return jsonError('RATE_LIMITED', 'Too many registrations from this IP', 429, {
        resetAt: rl.resetAt.toISOString(),
      });
    }

    const session = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, isWebinar: true, title: true, scheduledStart: true },
    });
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    if (!session.isWebinar) {
      return jsonError('CONFLICT', 'Session is not a webinar', 409);
    }

    const confirmToken = randomBytes(24).toString('hex');
    const emailLower = body.data.email.toLowerCase();

    // Idempotent on (sessionId, email): a re-register refreshes the token
    // and resends the email. Audit: keep all rows on email collision (rare),
    // not worth tracking.
    const reg = await db.webinarRegistration.upsert({
      where: { sessionId_email: { sessionId, email: emailLower } },
      create: {
        sessionId,
        email: emailLower,
        name: body.data.name,
        organisation: body.data.organisation ?? null,
        roleTitle: body.data.roleTitle ?? null,
        source: body.data.source ?? null,
        consented: true,
        confirmToken,
      },
      update: {
        name: body.data.name,
        organisation: body.data.organisation ?? null,
        roleTitle: body.data.roleTitle ?? null,
        source: body.data.source ?? null,
        consented: true,
        confirmToken,
        confirmedAt: null,
      },
    });

    const confirmUrl = `${env.NEXTAUTH_URL}/webinar/${sessionId}/confirm?t=${confirmToken}`;
    // Best-effort email — registration is already saved either way.
    void sendEmail({
      to: reg.email,
      subject: `Confirm your registration: ${session.title}`,
      html: `
        <p>Hi ${reg.name.replace(/[<>&]/g, '')},</p>
        <p>Please confirm your registration for <strong>${session.title.replace(/[<>&]/g, '')}</strong>
           on ${session.scheduledStart.toUTCString()}.</p>
        <p><a href="${confirmUrl}">Confirm registration</a></p>
        <p>If you did not register, ignore this email.</p>
      `,
    }).catch((e) => console.error('[webinar-reg] email send failed:', e));

    return jsonOk({ registered: true, requiresConfirmation: true }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const { id: sessionId } = await ctx.params;
    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (role !== 'HOST' && role !== 'CO_HOST') {
      return jsonError('FORBIDDEN', 'Host/co-host only', 403);
    }

    const regs = await db.webinarRegistration.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        organisation: true,
        roleTitle: true,
        source: true,
        confirmedAt: true,
        attendedAt: true,
        createdAt: true,
      },
    });
    return jsonOk({
      registrations: regs,
      counts: {
        total: regs.length,
        confirmed: regs.filter((r) => r.confirmedAt).length,
        attended: regs.filter((r) => r.attendedAt).length,
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

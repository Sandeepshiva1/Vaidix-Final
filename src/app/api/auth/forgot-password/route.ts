import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email';
import { renderPasswordResetEmail } from '@/lib/email-templates';
import { forgotPasswordSchema } from '@/lib/validation/auth';
import { parseBody, jsonError, handleUnexpected } from '@/server/services/api-helpers';
import { mintToken, hashToken } from '@/server/services/tokens';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const RESET_EXPIRY_MIN = 60;

export async function POST(req: Request) {
  try {
    const meta = extractRequestMetadata(req);
    // IP-keyed bucket — fail-closed for credential paths (security hardening).
    const rl = await checkRateLimit({
      bucket: `forgot:${meta.ipAddress ?? 'unknown'}`,
      ...LIMITS.FORGOT_PASSWORD,
    });
    if (!rl.allowed) {
      return jsonError('RATE_LIMITED', 'Too many requests. Please try again later.', 429);
    }

    const parsed = await parseBody(req, forgotPasswordSchema);
    if (!parsed.ok) return parsed.response;
    const { identifier, identifierKind } = parsed.data;

    // Resolve user by the kind that was detected. No OR-clause across columns
    // — see auth-service.ts for the rationale (avoid query-planner side-channel).
    const user =
      identifierKind === 'email'
        ? await db.user.findUnique({ where: { email: identifier } })
        : identifierKind === 'mobile'
          ? await db.user.findUnique({ where: { mobile: identifier } })
          : await db.user.findUnique({ where: { username: identifier } });

    // Constant response regardless of user existence (prevents enumeration).
    // The dummy-delay branch below keeps response time indistinguishable.

    if (user && user.status === 'ACTIVE' && user.email) {
      const token = mintToken(32);
      const tokenHashed = hashToken(token);
      const expiresAt = new Date(Date.now() + RESET_EXPIRY_MIN * 60_000);

      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          token: tokenHashed,
          expiresAt,
        },
      });

      const resetUrl = `${env.NEXTAUTH_URL}/reset-password/${token}`;
      const { subject, html } = renderPasswordResetEmail({
        userName: user.name,
        resetUrl,
        expiresAt,
        ipAddress: meta.ipAddress ?? undefined,
      });

      try {
        await sendEmail({ to: user.email, subject, html });
      } catch (err) {
        console.error('[forgot-password] email send failed:', err);
      }

      await audit({
        actorId: user.id,
        eventType: AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
        entityType: 'user',
        entityId: user.id,
        summary: 'Password reset requested',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        // identifierKind is logged so SREs can review which channel users
        // initiate resets through — never log the raw identifier (PII).
        details: { identifierKind },
      });
    } else {
      // Dummy delay to prevent identifier enumeration via timing.
      await new Promise((r) => setTimeout(r, 300));
    }

    return NextResponse.json({
      ok: true,
      data: {
        message:
          'If a Vaidix account is associated with this email, mobile, or username, a reset link has been sent to the email on file.',
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

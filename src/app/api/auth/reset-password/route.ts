import { db } from '@/lib/db';
import { resetPasswordSchema } from '@/lib/validation/auth';
import { jsonOk, jsonError, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { hashToken } from '@/server/services/tokens';
import { hashPassword } from '@/server/services/auth-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export async function POST(req: Request) {
  try {
    const meta = extractRequestMetadata(req);
    const parsed = await parseBody(req, resetPasswordSchema);
    if (!parsed.ok) return parsed.response;

    const tokenHash = hashToken(parsed.data.token);
    const resetToken = await db.passwordResetToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      return jsonError('INVALID_TOKEN', 'Reset link is invalid or has expired', 400);
    }

    const newHash = await hashPassword(parsed.data.newPassword);

    await db.$transaction([
      db.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash: newHash,
          passwordVersion: { increment: 1 }, // invalidates existing sessions
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      db.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
      // Invalidate other unused reset tokens for the same user
      db.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, used: false, id: { not: resetToken.id } },
        data: { used: true },
      }),
    ]);

    await audit({
      actorId: resetToken.userId,
      eventType: AUDIT_EVENTS.PASSWORD_RESET_COMPLETED,
      entityType: 'user',
      entityId: resetToken.userId,
      summary: 'Password reset completed',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return jsonOk({ message: 'Password updated. Please sign in.' });
  } catch (err) {
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/change-password
// ════════════════════════════════════════════════════════════════════════════
// Authenticated user rotates their own password. Verifies current password
// with bcrypt, re-hashes the new one, bumps passwordVersion (which invalidates
// every existing session via NextAuth jwt callback), and clears lockout state.

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { changePasswordSchema } from '@/lib/validation/auth';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { hashPassword } from '@/server/services/auth-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export async function POST(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const body = await parseBody(req, changePasswordSchema);
    if (!body.ok) return body.response;

    const meta = extractRequestMetadata(req);

    const user = await db.user.findUnique({
      where: { id: gate.user.id },
      select: { id: true, passwordHash: true, status: true },
    });
    if (!user || !user.passwordHash) {
      return jsonError('INVALID_CREDENTIALS', 'Current password is incorrect', 400);
    }

    const currentOk = await bcrypt.compare(body.data.currentPassword, user.passwordHash);
    if (!currentOk) {
      await audit({
        actorId: user.id,
        eventType: AUDIT_EVENTS.PASSWORD_CHANGED,
        entityType: 'user',
        entityId: user.id,
        summary: 'Password change rejected — current password incorrect',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return jsonError('INVALID_CREDENTIALS', 'Current password is incorrect', 400);
    }

    const newHash = await hashPassword(body.data.newPassword);

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          passwordVersion: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      // Invalidate any outstanding password-reset tokens once the user
      // successfully rotates their own password.
      db.passwordResetToken.updateMany({
        where: { userId: user.id, used: false },
        data: { used: true },
      }),
    ]);

    await audit({
      actorId: user.id,
      eventType: AUDIT_EVENTS.PASSWORD_CHANGED,
      entityType: 'user',
      entityId: user.id,
      summary: 'Password changed by user',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return jsonOk({ message: 'Password updated. Please sign in again on other devices.' });
  } catch (err) {
    return handleUnexpected(err);
  }
}

import { acceptInvitationSchema } from '@/lib/validation/auth';
import {
  jsonOk,
  jsonError,
  parseBody,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { acceptInvitation } from '@/server/services/invitation-service';
import { ADMIN_LIMIT_CODE, adminLimitMessage } from '@/server/services/admin-limits';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { extractRequestMetadata } from '@/server/services/audit';

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const meta = extractRequestMetadata(req);
    const rl = await checkRateLimit({
      bucket: `accept-invite:${meta.ipAddress ?? 'unknown'}`,
      ...LIMITS.ACCEPT_INVITE,
    });
    if (!rl.allowed) {
      return jsonError('RATE_LIMITED', 'Too many requests. Please try again later.', 429);
    }

    const { token } = await ctx.params;
    const parsed = await parseBody(req, acceptInvitationSchema);
    if (!parsed.ok) return parsed.response;

    if (parsed.data.token !== token) {
      return jsonError('TOKEN_MISMATCH', 'Token in body does not match URL', 400);
    }

    try {
      const user = await acceptInvitation(token, parsed.data.password, meta);
      return jsonOk({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        message: 'Welcome to Vaidix. You can now sign in.',
      }, { status: 201 });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'INVALID_TOKEN') return jsonError('INVALID_TOKEN', 'Invalid invitation link', 404);
      if (code === 'NOT_PENDING') return jsonError('NOT_PENDING', 'This invitation cannot be accepted', 410);
      if (code === 'EXPIRED') return jsonError('EXPIRED', 'This invitation has expired', 410);
      if (code === 'USER_EXISTS') return jsonError('USER_EXISTS', 'An account already exists for this email', 409);
      if (code === ADMIN_LIMIT_CODE) return jsonError('ADMIN_LIMIT', adminLimitMessage, 409);
      throw err;
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}

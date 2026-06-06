// POST — create (or return the existing) public no-login share link for a
// session  |  DELETE — revoke all active public shares for the session.
import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import {
  createSessionShare,
  revokeSessionShare,
  SessionShareError,
} from '@/server/services/sessions/session-share-service';
import { env } from '@/lib/env';

function translate(err: unknown) {
  if (err instanceof SessionShareError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 410;
    return jsonError(err.code, err.message, status);
  }
  return handleUnexpected(err);
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const link = await createSessionShare(
      { sessionId: id, actor: { userId: gate.user.id, role: gate.user.role } },
      env.NEXTAUTH_URL,
    );
    return jsonOk(link);
  } catch (err) {
    return translate(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    await revokeSessionShare(id, { userId: gate.user.id, role: gate.user.role });
    return jsonOk({ revoked: true });
  } catch (err) {
    return translate(err);
  }
}

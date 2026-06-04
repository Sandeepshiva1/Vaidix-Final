// POST — generate/refresh share link  |  DELETE — revoke
import { jsonOk, jsonError, requireAuth, handleUnexpected, parseBody } from '@/server/services/api-helpers';
import { generateShareToken, revokeShareToken } from '@/server/services/session-service';
import { env } from '@/lib/env';
import { z } from 'zod';

const genSchema = z.object({
  ttlHours: z.number().int().min(1).max(24 * 7).default(24),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, genSchema);
    if (!body.ok) return body.response;
    const { id } = await ctx.params;
    const { token, expiresAt } = await generateShareToken(
      id,
      gate.user.id,
      gate.user.role,
      body.data.ttlHours
    );
    const base = env.NEXTAUTH_URL.replace(/\/$/, '');
    const url = `${base}/classroom/${id}?t=${token}`;
    return jsonOk({ url, token, expiresAt });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host, proposer, or admin', 403);
    return handleUnexpected(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    await revokeShareToken(id, gate.user.id, gate.user.role);
    return jsonOk({ revoked: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host, proposer, or admin', 403);
    return handleUnexpected(err);
  }
}

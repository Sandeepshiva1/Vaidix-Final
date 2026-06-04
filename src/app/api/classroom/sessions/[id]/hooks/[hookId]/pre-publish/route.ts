// /api/classroom/sessions/[id]/hooks/[hookId]/pre-publish — W9.4
// POST   — pre-publishes the hook (residents can now vote before the session)
// DELETE — revokes pre-publish (hook hidden from residents; responses kept)

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  prePublishHook,
  unPrePublishHook,
} from '@/server/services/hooks/hooks-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

function mapError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : '';
  if (/not found/i.test(msg)) return jsonError('NOT_FOUND', msg, 404);
  if (/Only host|host\/PD\/admin/i.test(msg)) return jsonError('FORBIDDEN', msg, 403);
  if (/options/i.test(msg)) return jsonError('VALIDATION', msg, 400);
  return handleUnexpected(err);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string; hookId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { hookId } = await ctx.params;
  try {
    const result = await prePublishHook(hookId, { userId: auth.user.id, role: auth.user.role });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_PRE_PUBLISHED,
      entityType: 'LiveHook',
      entityId: hookId,
      summary: 'Hook pre-published for resident voting',
      details: { prePublishedAt: result.prePublishedAt },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result);
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; hookId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { hookId } = await ctx.params;
  try {
    await unPrePublishHook(hookId, { userId: auth.user.id, role: auth.user.role });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_PRE_UNPUBLISHED,
      entityType: 'LiveHook',
      entityId: hookId,
      summary: 'Hook pre-publish revoked',
      ...extractRequestMetadata(req),
    });
    return jsonOk({ revoked: true });
  } catch (err) {
    return mapError(err);
  }
}

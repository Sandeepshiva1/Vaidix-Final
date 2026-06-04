// /api/classroom/sessions/[id]/hooks/[hookId]
// PATCH: host edits the draft (prompt/options/correct/kind/explanation)
// DELETE: host removes the draft (refused when responses exist; use the
//   pre-publish DELETE endpoint to take it off the resident view while
//   keeping the data + audit trail).

import { z } from 'zod';
import { LiveHookKind } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  updateHookDraft,
  deleteHookDraft,
} from '@/server/services/hooks/hooks-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const patchSchema = z.object({
  prompt: z.string().min(1).max(1000).optional(),
  options: z.array(z.string().min(1).max(120)).min(2).max(8).optional(),
  correctOption: z.string().max(120).nullable().optional(),
  explanation: z.string().max(2000).nullable().optional(),
  kind: z.nativeEnum(LiveHookKind).optional(),
});

function mapError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : '';
  if (/not found/i.test(msg)) return jsonError('NOT_FOUND', msg, 404);
  if (/Only host|host\/PD\/admin/i.test(msg)) return jsonError('FORBIDDEN', msg, 403);
  if (/Cannot edit|Cannot delete|with responses/i.test(msg)) return jsonError('HAS_RESPONSES', msg, 409);
  return handleUnexpected(err);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; hookId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const { hookId } = await ctx.params;

  try {
    await updateHookDraft(hookId, body.data, { userId: auth.user.id, role: auth.user.role });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_UPDATED,
      entityType: 'LiveHook',
      entityId: hookId,
      summary: 'Hook draft updated',
      details: { fields: Object.keys(body.data) },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ updated: true });
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; hookId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { hookId } = await ctx.params;
  try {
    await deleteHookDraft(hookId, { userId: auth.user.id, role: auth.user.role });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_DELETED,
      entityType: 'LiveHook',
      entityId: hookId,
      summary: 'Hook draft deleted',
      ...extractRequestMetadata(req),
    });
    return jsonOk({ deleted: true });
  } catch (err) {
    return mapError(err);
  }
}

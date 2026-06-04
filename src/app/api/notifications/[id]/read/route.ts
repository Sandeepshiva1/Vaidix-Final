// PATCH /api/notifications/[id]/read — mark a single notification read.
//
// Returns 404 if the row does not exist or does not belong to the caller —
// keeping enumeration semantics tight (no leak of "this id exists for someone").

import {
  jsonOk,
  jsonError,
  requireAuth,
  requireCsrf,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { markRead } from '@/server/services/notifications-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;

    const { id } = await ctx.params;
    const ok = await markRead(gate.user.id, id);
    if (!ok) return jsonError('NOT_FOUND', 'Notification not found', 404);
    return jsonOk({ id });
  } catch (err) {
    return handleUnexpected(err);
  }
}

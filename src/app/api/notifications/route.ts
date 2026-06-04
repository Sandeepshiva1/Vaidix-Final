// GET /api/notifications — list the authenticated user's IN_APP notifications.
//
//   ?unread=1   only unread rows
//   ?limit=N    cap rows (default 30, max 100)
//
// Response: { items: NotificationView[]; unreadCount: number }

import { z } from 'zod';
import {
  jsonOk,
  requireAuth,
  parseQuery,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { listForUser } from '@/server/services/notifications-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  unread: z.enum(['0', '1', 'true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const q = await parseQuery(req, querySchema);
    if (!q.ok) return q.response;

    const onlyUnread = q.data.unread === '1' || q.data.unread === 'true';
    const result = await listForUser(gate.user.id, {
      onlyUnread,
      limit: q.data.limit,
    });
    return jsonOk(result);
  } catch (err) {
    return handleUnexpected(err);
  }
}

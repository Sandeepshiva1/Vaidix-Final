// POST /api/notifications/mark-all-read — clear the unread badge in one shot.

import {
  jsonOk,
  requireAuth,
  requireCsrf,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { markAllRead } from '@/server/services/notifications-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;

    const updated = await markAllRead(gate.user.id);
    return jsonOk({ updated });
  } catch (err) {
    return handleUnexpected(err);
  }
}

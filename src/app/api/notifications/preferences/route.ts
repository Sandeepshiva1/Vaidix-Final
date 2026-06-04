// GET  /api/notifications/preferences — list IN_APP notification preferences for the current user.
//      Returns all known kinds; kinds with no DB row default to enabled=true.
// PUT  /api/notifications/preferences — upsert a single preference.
//      Body: { kind: string; channel: "IN_APP"; enabled: boolean }

import { z } from 'zod';
import {
  jsonOk,
  requireAuth,
  requireCsrf,
  parseBody,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { getPreferences, upsertPreference } from '@/server/services/notifications-service';
import { NotificationChannel } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const prefs = await getPreferences(gate.user.id);
    return jsonOk(prefs);
  } catch (err) {
    return handleUnexpected(err);
  }
}

const putSchema = z.object({
  kind: z.string().min(1).max(80),
  channel: z.literal('IN_APP'),
  enabled: z.boolean(),
});

export async function PUT(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;
    const b = await parseBody(req, putSchema);
    if (!b.ok) return b.response;

    const pref = await upsertPreference(
      gate.user.id,
      b.data.kind,
      NotificationChannel[b.data.channel],
      b.data.enabled
    );
    return jsonOk(pref);
  } catch (err) {
    return handleUnexpected(err);
  }
}

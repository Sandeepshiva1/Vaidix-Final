// ════════════════════════════════════════════════════════════════════════════
// GET/POST /api/calendar/subscribe
// ════════════════════════════════════════════════════════════════════════════
// GET  — returns the signed iCal feed URL for the logged-in user, minting one
//        if none exists yet.
// POST — rotates the token (revokes any external subscriptions using the old).

import { jsonOk, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import {
  getOrMintFeedToken,
  rotateFeedToken,
  feedUrlFor,
} from '@/server/services/ical-feed-service';

export async function GET() {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const token = await getOrMintFeedToken(gate.user.id);
    return jsonOk({ url: feedUrlFor(gate.user.id, token) });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST() {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const token = await rotateFeedToken(gate.user.id);
    return jsonOk({ url: feedUrlFor(gate.user.id, token), rotated: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

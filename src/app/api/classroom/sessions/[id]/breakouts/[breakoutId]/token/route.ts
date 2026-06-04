// W5 — mint a LiveKit token for the breakout child room
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import {
  mintBreakoutToken,
  BreakoutError,
} from '@/server/services/breakouts/breakout-service';
import { mapBreakoutError } from '../../route';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; breakoutId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id, breakoutId } = await ctx.params;
    const result = await mintBreakoutToken(
      { userId: gate.user.id, userName: gate.user.name, role: gate.user.role },
      id,
      breakoutId
    );
    return jsonOk(result);
  } catch (err) {
    if (err instanceof BreakoutError) {
      const mapped = mapBreakoutError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

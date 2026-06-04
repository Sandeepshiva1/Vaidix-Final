// read the breakout agent log entries
// (Ingest is in ./ingest/route.ts under bearer-token auth, per BREAKOUT-AGENT-CONTRACT.md)
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import {
  listAgentLog,
  BreakoutError,
} from '@/server/services/breakouts/breakout-service';
import { mapBreakoutError } from '../../route';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; breakoutId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { breakoutId } = await ctx.params;
    const items = await listAgentLog(breakoutId);
    return jsonOk({ items });
  } catch (err) {
    if (err instanceof BreakoutError) {
      const mapped = mapBreakoutError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

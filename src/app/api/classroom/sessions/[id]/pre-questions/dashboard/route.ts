// presenter dashboard: top-N themes with example questions (host/PD/admin)
import { z } from 'zod';
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
  parseQuery,
} from '@/server/services/api-helpers';
import { getDashboard, PreQuestionError } from '@/server/services/pre-questions/pre-questions-service';
import { mapPreQuestionError } from '../route';

const querySchema = z.object({
  topN: z.coerce.number().int().min(1).max(20).optional(),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const q = await parseQuery(req, querySchema);
    if (!q.ok) return q.response;
    const { id } = await ctx.params;
    const dashboard = await getDashboard(
      { userId: gate.user.id, role: gate.user.role },
      id,
      q.data.topN ?? 10
    );
    return jsonOk(dashboard);
  } catch (err) {
    if (err instanceof PreQuestionError) {
      const mapped = mapPreQuestionError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

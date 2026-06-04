// host/PD/admin: bypass the 30s debounce and force an immediate re-cluster
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { forceRecluster, PreQuestionError } from '@/server/services/pre-questions/pre-questions-service';
import { mapPreQuestionError } from '../route';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    await forceRecluster({ userId: gate.user.id, role: gate.user.role }, id);
    return jsonOk({ enqueued: true });
  } catch (err) {
    if (err instanceof PreQuestionError) {
      const mapped = mapPreQuestionError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

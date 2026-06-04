// like / unlike a Q&A item
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { setLike, QaError } from '@/server/services/qa/qa-service';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; qaId: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { qaId } = await ctx.params;
    const result = await setLike({ userId: gate.user.id, role: gate.user.role }, qaId, true);
    return jsonOk(result);
  } catch (err) {
    if (err instanceof QaError && err.code === 'NOT_FOUND') {
      return jsonError('NOT_FOUND', err.message, 404);
    }
    return handleUnexpected(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; qaId: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { qaId } = await ctx.params;
    const result = await setLike({ userId: gate.user.id, role: gate.user.role }, qaId, false);
    return jsonOk(result);
  } catch (err) {
    if (err instanceof QaError && err.code === 'NOT_FOUND') {
      return jsonError('NOT_FOUND', err.message, 404);
    }
    return handleUnexpected(err);
  }
}

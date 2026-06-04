// list current AI-generated themes for a session (anyone with visibility)
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { listThemes, PreQuestionError } from '@/server/services/pre-questions/pre-questions-service';
import { mapPreQuestionError } from '../route';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const items = await listThemes({ userId: gate.user.id, role: gate.user.role }, id);
    return jsonOk({ items });
  } catch (err) {
    if (err instanceof PreQuestionError) {
      const mapped = mapPreQuestionError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

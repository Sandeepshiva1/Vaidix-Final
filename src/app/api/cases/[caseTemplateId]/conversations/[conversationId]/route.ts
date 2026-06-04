// fetch a single conversation with its full message history
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { getConversation, CasesError } from '@/server/services/cases/cases-service';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ caseTemplateId: string; conversationId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { conversationId } = await ctx.params;
    const conv = await getConversation(
      { userId: gate.user.id, role: gate.user.role },
      conversationId
    );
    return jsonOk(conv);
  } catch (err) {
    if (err instanceof CasesError) {
      if (err.code === 'NOT_FOUND') return jsonError('NOT_FOUND', err.message, 404);
      if (err.code === 'FORBIDDEN') return jsonError('FORBIDDEN', err.message, 403);
    }
    return handleUnexpected(err);
  }
}

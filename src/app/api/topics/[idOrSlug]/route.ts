// W6 — fetch one topic by id or slug, with shallow hierarchy + counts
import {
  jsonOk,
  jsonError,
  requireAuthWithProgram,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { getTopic, TopicError } from '@/server/services/topics/topics-service';

export async function GET(_req: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  try {
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const { idOrSlug } = await ctx.params;
    const topic = await getTopic(idOrSlug, gate.user.activeProgramId);
    return jsonOk(topic);
  } catch (err) {
    if (err instanceof TopicError) {
      return jsonError('NOT_FOUND', err.message, 404);
    }
    return handleUnexpected(err);
  }
}

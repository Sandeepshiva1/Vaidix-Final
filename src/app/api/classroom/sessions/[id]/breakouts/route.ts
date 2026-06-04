// list and create breakouts on a session
import { z } from 'zod';
import { BreakoutGroupingMode } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import {
  createBreakouts,
  listBreakouts,
  BreakoutError,
} from '@/server/services/breakouts/breakout-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const createSchema = z.object({
  groupingMode: z.nativeEnum(BreakoutGroupingMode),
  groupCount: z.number().int().min(1).max(16),
  candidateUserIds: z.array(z.string()).optional(),
  namePrefix: z.string().trim().min(1).max(40).optional(),
});

function mapBreakoutError(err: unknown): Response | null {
  if (!(err instanceof BreakoutError)) return null;
  switch (err.code) {
    case 'NOT_FOUND':
      return jsonError('NOT_FOUND', err.message, 404);
    case 'FORBIDDEN':
      return jsonError('FORBIDDEN', err.message, 403);
    case 'NOT_LIVE':
      return jsonError('NOT_LIVE', err.message, 409);
    case 'AI_GROUPING_DEFERRED':
      return jsonError('AI_GROUPING_DEFERRED', err.message, 501);
    case 'BREAKOUT_ENDED':
      return jsonError('BREAKOUT_ENDED', err.message, 409);
    case 'NOT_ASSIGNED':
      return jsonError('NOT_ASSIGNED', err.message, 403);
    default:
      return jsonError('INVALID', err.message, 400);
  }
}

export { mapBreakoutError };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const items = await listBreakouts(id);
    return jsonOk({ items });
  } catch (err) {
    return mapBreakoutError(err) ?? handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;
    const { id } = await ctx.params;
    const created = await createBreakouts(
      { userId: gate.user.id, userName: gate.user.name, role: gate.user.role },
      { sessionId: id, ...body.data }
    );
    const meta = extractRequestMetadata(req);
    for (const b of created) {
      await audit({
        actorId: gate.user.id,
        actorRole: gate.user.role,
        eventType: AUDIT_EVENTS.BREAKOUT_CREATED,
        entityType: 'Breakout',
        entityId: b.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        details: {
          sessionId: id,
          groupingMode: body.data.groupingMode,
          memberCount: b.participants.length,
        },
      });
    }
    return jsonOk({ items: created }, { status: 201 });
  } catch (err) {
    return mapBreakoutError(err) ?? handleUnexpected(err);
  }
}

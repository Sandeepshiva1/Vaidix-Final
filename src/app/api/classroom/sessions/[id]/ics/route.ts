import { jsonError, requireAuth } from '@/server/services/api-helpers';
import { getSession } from '@/server/services/session-service';
import { buildSessionIcs, sessionJoinUrl } from '@/server/services/ics-service';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAuth();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);

  const ics = buildSessionIcs({
    id: session.id,
    title: session.title,
    description: session.description,
    start: session.scheduledStart,
    end: session.scheduledEnd,
    host: { name: session.host.name, email: session.host.email },
    joinUrl: sessionJoinUrl(session.id),
    recurrenceRule: session.recurrenceRule,
    recurrenceUntil: session.recurrenceUntil,
    status: session.approvalStatus === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="vaidix-session-${session.id}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}

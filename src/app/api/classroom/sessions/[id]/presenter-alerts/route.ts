// GET /api/classroom/sessions/[id]/presenter-alerts
// SSE stream of presenter alerts (host-only). Polls the evaluator periodically
// and pushes new alerts to the connected presenter.
//
// POST /api/classroom/sessions/[id]/presenter-alerts/[alertId]/ack lives in
// the [alertId] subroute (not in this file).

import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import { jsonError, requireAuth } from '@/server/services/api-helpers';
import {
  evaluatePresenterAlerts,
  listUnreadPresenterAlerts,
} from '@/server/services/engagement/engagement-service';

export const dynamic = 'force-dynamic';

const EVAL_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
  if (
    session.hostId !== auth.user.id &&
    auth.user.role !== Role.ADMIN &&
    auth.user.role !== Role.PROGRAM_DIRECTOR
  ) {
    return jsonError('FORBIDDEN', 'Presenter alerts are private to host', 403);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const alreadySent = new Set<string>();

      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send('hello', { sessionId });

      let cancelled = false;
      let lastEvalAt = 0;

      const tick = async () => {
        if (cancelled) return;
        try {
          const now = Date.now();
          if (now - lastEvalAt >= EVAL_INTERVAL_MS) {
            await evaluatePresenterAlerts(sessionId);
            lastEvalAt = now;
          }
          const alerts = await listUnreadPresenterAlerts(sessionId, auth.user.id, auth.user.role);
          for (const a of alerts) {
            if (alreadySent.has(a.id)) continue;
            alreadySent.add(a.id);
            send('alert', a);
          }
        } catch (err) {
          send('error', { message: (err as Error).message });
        }
      };

      const interval = setInterval(tick, POLL_INTERVAL_MS);
      void tick();

      req.signal.addEventListener('abort', () => {
        cancelled = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

// GET /api/classroom/sessions/[id]/live-captions
// SSE stream of live caption segments. Producer: Python LiveKit Agent posts to
// /ingest. Broadcast: Redis pub/sub channel `caption:<sessionId>`.

import { requireAuth, jsonError } from '@/server/services/api-helpers';
import { makeRedisConnection } from '@/lib/redis';
import { liveCaptionChannel } from '@/server/services/captions/captions-pubsub';
import { getEffectiveSessionRole } from '@/server/services/session-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  // Authorization: only members who can see this session may stream its live
  // transcript (potential PHI). Mirrors the chat route's access gate — without
  // this, any authenticated user could subscribe to any session's captions.
  const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
  if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

  const sub = makeRedisConnection();
  const channel = liveCaptionChannel(sessionId);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send('hello', { sessionId, ts: Date.now() });

      sub.on('message', (_ch, payload) => {
        try {
          const parsed = JSON.parse(payload);
          send('caption', parsed);
        } catch {
          /* ignore malformed payloads */
        }
      });
      try {
        await sub.subscribe(channel);
      } catch (err) {
        send('error', { message: (err as Error).message });
      }

      const heartbeat = setInterval(() => send('ping', { ts: Date.now() }), 20_000);

      let closed = false;
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          await sub.unsubscribe(channel);
        } catch {
          /* swallow */
        }
        sub.disconnect();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime — fine.
        }
      };
      req.signal.addEventListener('abort', cleanup);
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
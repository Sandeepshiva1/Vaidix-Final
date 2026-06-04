// ════════════════════════════════════════════════════════════════════════════
// GET /api/classroom/sessions/[id]/recordings
// ════════════════════════════════════════════════════════════════════════════
// Lists recordings for a session with signed playback URLs + caption tracks.
// Access enforced via RecordingService (host, participant, cohort, visibility).

import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { listSessionRecordings, RecordingAccessError } from '@/server/services/recordings/recording-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  try {
    const recordings = await listSessionRecordings(
      { userId: auth.user.id, role: auth.user.role },
      sessionId
    );
    if (recordings.length > 0) {
      await audit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        eventType: AUDIT_EVENTS.RECORDING_VIEWED,
        entityType: 'TeachingSession',
        entityId: sessionId,
        summary: `Recording list accessed (${recordings.length} item${recordings.length === 1 ? '' : 's'})`,
        details: { sessionId, count: recordings.length },
        ...extractRequestMetadata(req),
      });
    }
    return jsonOk({ recordings });
  } catch (err) {
    if (err instanceof RecordingAccessError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 403;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/classroom/sessions/[id]/transcripts
// ════════════════════════════════════════════════════════════════════════════
// Returns transcript metadata + signed VTT URLs for the session's recording.

import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { presignDownload } from '@/lib/storage';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  try {
    const recording = await db.recording.findUnique({
      where: { sessionId },
      include: {
        transcripts: {
          select: { id: true, language: true, source: true, diarized: true, piiRedacted: true, createdAt: true },
        },
      },
    });
    if (!recording) return jsonError('NOT_FOUND', 'No recording for this session', 404);

    const tracks = await Promise.all(
      recording.transcripts.map(async (t) => {
        const vttKey = `captions/${sessionId}/${t.language}.vtt`;
        const vttUrl = await presignDownload(vttKey, 6 * 3600).catch(() => null);
        return { ...t, createdAt: t.createdAt.toISOString(), vttUrl };
      })
    );
    return jsonOk({ recordingId: recording.id, sessionId, tracks });
  } catch (err) {
    return handleUnexpected(err);
  }
}

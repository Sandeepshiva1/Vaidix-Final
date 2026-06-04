// ════════════════════════════════════════════════════════════════════════════
// GET /api/classroom/sessions/[id]/captions/transcript
// ════════════════════════════════════════════════════════════════════════════
// Read the persisted live transcript(s) for a session. Used by the
// post-session export UI (Word/PDF) and by the Gemini summary endpoint
// (Phase 2). One row per language; segments sorted by startMs.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import { listTranscriptsForSession } from '@/server/services/captions/transcript-service';

interface Segment {
  startMs: number;
  endMs?: number;
  text: string;
  speakerName?: string | null;
}

function fmtVttTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const f = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;

  // Same access gate as the live captions SSE — anyone who can see the
  // session can read its transcript. Tighter (host-only) gating belongs
  // on the export endpoint, not here.
  const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
  if (!role) {
    return jsonError('FORBIDDEN', 'You do not have access to this session', 403);
  }

  // ?format=vtt → WebVTT export for the recording-page TranscriptTab.
  // Default JSON read otherwise.
  const url = new URL(req.url);
  const format = url.searchParams.get('format');

  try {
    if (format === 'vtt') {
      const transcripts = await listTranscriptsForSession(sessionId);
      const en = transcripts.find((t) => t.language === 'en') ?? transcripts[0];
      if (!en) return jsonError('NOT_FOUND', 'No transcript found for this session', 404);
      const segments = (en.segments as unknown as Segment[]) ?? [];
      const lines = ['WEBVTT', ''];
      segments.forEach((s, i) => {
        const start = s.startMs;
        const end   = s.endMs ?? s.startMs + 4000;
        lines.push(String(i + 1));
        lines.push(`${fmtVttTime(start)} --> ${fmtVttTime(end)}`);
        lines.push(s.speakerName ? `<v ${s.speakerName}>${s.text}` : s.text);
        lines.push('');
      });
      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const transcripts = await listTranscriptsForSession(sessionId);

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.CAPTIONS_TRANSCRIPT_READ,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: `Live transcript read (${transcripts.length} language tracks)`,
      details: { languages: transcripts.map((t) => t.language) },
      ...extractRequestMetadata(req),
    });

    return jsonOk({
      sessionId,
      transcripts: transcripts.map((t) => ({
        id: t.id,
        language: t.language,
        // Vendor name ('deepgram', 'sarvam') redacted to 'asr' before wire.
        source: t.source === 'manual' ? 'manual' : 'asr',
        finalized: t.finalized,
        startedAt: t.startedAt.toISOString(),
        finalizedAt: t.finalizedAt?.toISOString() ?? null,
        segmentCount: t.segments.length,
        segments: t.segments,
        contentText: t.contentText,
      })),
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

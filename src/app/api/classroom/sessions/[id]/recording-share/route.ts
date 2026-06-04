// W5 — list + create recording shares for a session
// (Resolves to the session's recording, which Stream A creates after egress.)
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  jsonOk,
  jsonError,
  requireAuth,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import {
  createShare,
  listSharesForRecording,
  RecordingShareError,
} from '@/server/services/recordings/recording-share-service';
import { env } from '@/lib/env';

const createSchema = z.object({
  ttlDays: z.number().int().min(1).max(30).optional(),
  password: z.string().min(4).max(64).optional(),
});

function mapErr(err: unknown): Response | null {
  if (!(err instanceof RecordingShareError)) return null;
  switch (err.code) {
    case 'NOT_FOUND':
      return jsonError('NOT_FOUND', err.message, 404);
    case 'FORBIDDEN':
      return jsonError('FORBIDDEN', err.message, 403);
    case 'EXPIRED':
      return jsonError('EXPIRED', err.message, 410);
    case 'REVOKED':
      return jsonError('REVOKED', err.message, 410);
    case 'PASSWORD_REQUIRED':
      return jsonError('PASSWORD_REQUIRED', err.message, 401);
    case 'WRONG_PASSWORD':
      return jsonError('WRONG_PASSWORD', err.message, 401);
    default:
      return jsonError('INVALID', err.message, 400);
  }
}

export { mapErr as mapRecordingShareError };

async function recordingForSession(sessionId: string): Promise<{ id: string } | null> {
  return db.recording.findUnique({
    where: { sessionId },
    select: { id: true },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id } = await ctx.params;
    const recording = await recordingForSession(id);
    if (!recording) return jsonError('RECORDING_NOT_READY', 'No recording for this session', 409);
    const shares = await listSharesForRecording(
      { userId: gate.user.id, role: gate.user.role },
      recording.id
    );
    return jsonOk({ shares });
  } catch (err) {
    return mapErr(err) ?? handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;
    const { id } = await ctx.params;
    const recording = await recordingForSession(id);
    if (!recording) return jsonError('RECORDING_NOT_READY', 'No recording for this session', 409);

    const created = await createShare(
      { userId: gate.user.id, role: gate.user.role },
      {
        recordingId: recording.id,
        ttlDays: body.data.ttlDays,
        password: body.data.password,
      }
    );
    const base = env.NEXTAUTH_URL.replace(/\/$/, '');
    const url = `${base}/recordings/share/${created.token}`;
    return jsonOk({ ...created, url }, { status: 201 });
  } catch (err) {
    return mapErr(err) ?? handleUnexpected(err);
  }
}

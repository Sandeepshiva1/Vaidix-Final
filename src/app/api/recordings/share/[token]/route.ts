// W5 — public share resolver
// GET /api/recordings/share/[token] — used by the public viewer page.
// Optional `?p=<password>` query param, OR JSON POST body for password forms.
// Always logged (success + failure) to RecordingShareAccess + AuditEvent.

import {
  jsonOk,
  jsonError,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import {
  accessShare,
  RecordingShareError,
} from '@/server/services/recordings/recording-share-service';
import { extractRequestMetadata } from '@/server/services/audit';
import { z } from 'zod';

function mapErr(err: unknown): Response | null {
  if (!(err instanceof RecordingShareError)) return null;
  switch (err.code) {
    case 'NOT_FOUND':
      return jsonError('NOT_FOUND', err.message, 404);
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

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const url = new URL(req.url);
    const password = url.searchParams.get('p') ?? undefined;
    const meta = extractRequestMetadata(req);
    const result = await accessShare(token, password, meta);
    return jsonOk(result);
  } catch (err) {
    return mapErr(err) ?? handleUnexpected(err);
  }
}

const postSchema = z.object({ password: z.string().min(1).max(128) });

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const body = await parseBody(req, postSchema);
    if (!body.ok) return body.response;
    const meta = extractRequestMetadata(req);
    const result = await accessShare(token, body.data.password, meta);
    return jsonOk(result);
  } catch (err) {
    return mapErr(err) ?? handleUnexpected(err);
  }
}

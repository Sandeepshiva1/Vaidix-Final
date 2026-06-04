// POST /api/promo/share
// Faculty mints a public share link for the session's existing promo assets.
// Body: { sessionId, expiresInDays? }. Returns { shareId, token, url, expiresAt }.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  createPromoShare,
  getCurrentPromoShareForSession,
  PromoShareError,
} from '@/server/services/promo/promo-share-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';

const schema = z.object({
  sessionId: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

function statusFor(code: PromoShareError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'NO_ASSETS':
      return 422;
    default:
      return 400;
  }
}

/**
 * GET /api/promo/share?sessionId=... — fetch the current active share for a
 * session so the prep panel can restore the share URL after a page reload.
 * Returns { share: null } when no live share exists (revoked/expired/never
 * created), so the UI can stay quiet instead of treating "no share" as an
 * error.
 */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!sessionId) {
    return jsonError('VALIDATION_ERROR', 'sessionId query parameter is required', 400);
  }
  const origin = req.headers.get('origin') ?? new URL(req.url).origin;

  try {
    const share = await getCurrentPromoShareForSession(
      sessionId,
      { userId: auth.user.id, role: auth.user.role },
      origin
    );
    return jsonOk({ share });
  } catch (err) {
    if (err instanceof PromoShareError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const origin = req.headers.get('origin') ?? new URL(req.url).origin;

  try {
    const result = await createPromoShare(
      {
        sessionId: body.data.sessionId,
        expiresInDays: body.data.expiresInDays,
        actor: { userId: auth.user.id, role: auth.user.role },
      },
      origin
    );
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PROMO_SHARE_CREATED,
      entityType: 'PromoShare',
      entityId: result.shareId,
      summary: 'Created public promo share link',
      details: { sessionId: body.data.sessionId, expiresAt: result.expiresAt },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof PromoShareError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

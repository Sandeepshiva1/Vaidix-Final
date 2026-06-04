// GET /api/p/[token] — W9 (PUBLIC, no auth)
// Returns the promo bundle (session details + presigned SVG URLs) for a
// share token. Used by the public landing page at /p/[token].

import {
  handleUnexpected,
  jsonError,
  jsonOk,
} from '@/server/services/api-helpers';
import {
  getPublicPromoByToken,
  PromoShareError,
} from '@/server/services/promo/promo-share-service';

function statusFor(code: PromoShareError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'EXPIRED':
    case 'REVOKED':
      return 410;
    default:
      return 400;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const result = await getPublicPromoByToken(token);
    return jsonOk(result);
  } catch (err) {
    if (err instanceof PromoShareError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

// DELETE /api/promo/share/[shareId] — W9
// Faculty revokes a previously-published promo share. Idempotent.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  revokePromoShare,
  PromoShareError,
} from '@/server/services/promo/promo-share-service';
import {
  audit,
  AUDIT_EVENTS,
  extractRequestMetadata,
} from '@/server/services/audit';

function statusFor(code: PromoShareError['code']): number {
  return code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400;
}

export async function DELETE(req: Request, ctx: { params: Promise<{ shareId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { shareId } = await ctx.params;
  try {
    await revokePromoShare(shareId, { userId: auth.user.id, role: auth.user.role });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PROMO_SHARE_REVOKED,
      entityType: 'PromoShare',
      entityId: shareId,
      summary: 'Revoked promo share link',
      ...extractRequestMetadata(req),
    });
    return jsonOk({ revoked: true });
  } catch (err) {
    if (err instanceof PromoShareError) {
      return jsonError(err.code, err.message, statusFor(err.code));
    }
    return handleUnexpected(err);
  }
}

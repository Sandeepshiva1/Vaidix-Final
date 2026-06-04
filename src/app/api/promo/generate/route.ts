// POST /api/promo/generate — Stream A9
// Body: { sessionId, templates?: ['flyer'|'whatsapp_banner'|'instagram_card'][] }

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  generatePromoAssets,
  PromoAccessError,
  type PromoTemplate,
} from '@/server/services/promo/promo-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const TEMPLATES: PromoTemplate[] = ['flyer', 'whatsapp_banner', 'instagram_card'];

const schema = z.object({
  sessionId: z.string().min(1),
  templates: z.array(z.enum(TEMPLATES as [PromoTemplate, ...PromoTemplate[]])).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const rl = await checkRateLimit({
    bucket: `promo-gen:${auth.user.id}`,
    ...LIMITS.DOCUMENT_ANALYZE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Promo generation throttled', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await generatePromoAssets({
      sessionId: body.data.sessionId,
      templates: body.data.templates,
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_ANALYZED,
      entityType: 'Promo',
      entityId: body.data.sessionId,
      summary: `Generated ${result.documents.length} promo asset${result.documents.length === 1 ? '' : 's'}`,
      details: { sessionId: body.data.sessionId, count: result.documents.length },
      ...extractRequestMetadata(req),
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof PromoAccessError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

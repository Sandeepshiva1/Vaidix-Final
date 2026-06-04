// GET /api/blueprints — list current user's blueprints
// POST /api/blueprints — generate a new blueprint for a topic

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  generateBlueprint,
  listBlueprintsForUser,
  BlueprintError,
} from '@/server/services/blueprints/blueprint-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const PostBody = z.object({
  topic: z.string().min(3).max(280),
  learnerLevel: z.string().min(1).max(80).optional(),
  sessionLengthMinutes: z.number().int().min(15).max(240).optional(),
  clinicalSetting: z.string().min(1).max(400).optional(),
  priorKnowledgeAssumed: z.string().min(1).max(1000).optional(),
  constraints: z.string().min(1).max(1000).optional(),
});

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  try {
    const blueprints = await listBlueprintsForUser(auth.user.id);
    return jsonOk({ blueprints });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);

  const parsed = await parseBody(req, PostBody);
  if (!parsed.ok) return parsed.response;

  // Reuse the DECK_FORGE bucket — same upstream provider, similar billing.
  const rl = await checkRateLimit({
    bucket: `blueprint:${auth.user.id}`,
    ...LIMITS.DECK_FORGE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Blueprint requests throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const blueprint = await generateBlueprint({
      requestedById: auth.user.id,
      topic: parsed.data.topic,
      learnerLevel: parsed.data.learnerLevel,
      sessionLengthMinutes: parsed.data.sessionLengthMinutes,
      clinicalSetting: parsed.data.clinicalSetting,
      priorKnowledgeAssumed: parsed.data.priorKnowledgeAssumed,
      constraints: parsed.data.constraints,
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.BLUEPRINT_GENERATED,
      entityType: 'Blueprint',
      entityId: blueprint.id,
      summary: 'Curriculum blueprint generated',
      details: {
        topic: blueprint.topic,
        learnerLevel: blueprint.learnerLevel,
        sessionLengthMinutes: blueprint.sessionLengthMinutes,
        clinicalSetting: blueprint.clinicalSetting,
        priorKnowledgeAssumed: blueprint.priorKnowledgeAssumed,
        constraints: blueprint.constraints,
      },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ blueprint });
  } catch (err) {
    if (err instanceof BlueprintError) {
      const status = err.code === 'AI_UNAVAILABLE' ? 503 : 500;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

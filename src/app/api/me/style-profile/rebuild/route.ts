// ════════════════════════════════════════════════════════════════════════════
// POST /api/me/style-profile/rebuild — manually run Gemini distillation
// ════════════════════════════════════════════════════════════════════════════
// Same isolation contract: `facultyId` is derived from `auth.user.id`. The
// service itself only operates on the passed id. There is no admin overload.

import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import {
  rebuildFacultyStyleProfile,
  getFacultyStyleProfileForUi,
  DistillationError,
} from '@/server/services/decks/faculty-style-profile';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function POST(req: Request) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }

  // Rate-limit on the same bucket family as deck refines — both call a
  // foundation model. Keeps a faculty from hammering Gemini.
  const rl = await checkRateLimit({
    bucket: `style-profile-rebuild:${auth.user.id}`,
    ...LIMITS.DECK_REFINE,
  });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Rebuild throttled — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const profile = await rebuildFacultyStyleProfile(auth.user.id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.STYLE_PROFILE_REBUILT,
      entityType: 'FacultyStyleProfile',
      entityId: profile.id,
      summary: 'Style profile rebuilt by user',
      details: { version: profile.version, signalCountAtBuild: profile.signalCountAtBuild },
      ...extractRequestMetadata(req),
    });
    return jsonOk({
      profile: await getFacultyStyleProfileForUi(auth.user.id),
    });
  } catch (err) {
    if (err instanceof DistillationError) {
      const status =
        err.code === 'NOT_ENOUGH_SIGNALS' ? 400 :
        err.code === 'USER_DISABLED' ? 409 :
        err.code === 'AI_UNAVAILABLE' ? 503 :
        err.code === 'AI_UNPARSEABLE' ? 502 : 500;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

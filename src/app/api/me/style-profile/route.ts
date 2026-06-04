// ════════════════════════════════════════════════════════════════════════════
// /api/me/style-profile — read / replace / clear the caller's own profile
// ════════════════════════════════════════════════════════════════════════════
// All three handlers derive `facultyId` from `auth.user.id` ONLY. There is no
// id parameter in the path or body that admits another user's profile —
// `/api/me/*` is the self-scoped surface. This is the cross-user isolation
// guarantee at the API boundary.

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
import {
  getFacultyStyleProfileForUi,
  setFacultyStyleRules,
  clearFacultyStyleProfile,
} from '@/server/services/decks/faculty-style-profile';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const RuleSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  rule: z.string().trim().min(4).max(200),
  scopeTags: z
    .array(z.string().trim().min(1).max(40))
    .max(3)
    .optional(),
});

const PatchBody = z.object({
  rules: z.array(RuleSchema).max(10),
});

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  // Style profile is only meaningful for forging users.
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Only faculty / PD / admin have a style profile', 403);
  }
  try {
    const summary = await getFacultyStyleProfileForUi(auth.user.id);
    return jsonOk({ profile: summary });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function PATCH(req: Request) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const parsed = await parseBody(req, PatchBody);
  if (!parsed.ok) return parsed.response;

  try {
    const updated = await setFacultyStyleRules({
      facultyId: auth.user.id, // <-- authoritative scope; never from body
      rules: parsed.data.rules,
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.STYLE_PROFILE_UPDATED,
      entityType: 'FacultyStyleProfile',
      entityId: updated.id,
      summary: 'Style profile rules updated by user',
      details: { ruleCount: parsed.data.rules.length, version: updated.version },
      ...extractRequestMetadata(req),
    });
    return jsonOk({
      profile: await getFacultyStyleProfileForUi(auth.user.id),
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }

  try {
    await clearFacultyStyleProfile(auth.user.id);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.STYLE_PROFILE_CLEARED,
      entityType: 'FacultyStyleProfile',
      entityId: auth.user.id,
      summary: 'Style profile + all edit signals cleared by user',
      ...extractRequestMetadata(req),
    });
    return jsonOk({ cleared: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

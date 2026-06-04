// GET /api/blueprints/[id] — read one
// DELETE /api/blueprints/[id] — delete one

import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import {
  deleteBlueprintForUser,
  getBlueprintForUser,
} from '@/server/services/blueprints/blueprint-service';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { id } = await ctx.params;
  try {
    const blueprint = await getBlueprintForUser(id, auth.user.id);
    if (!blueprint) return jsonError('NOT_FOUND', 'Blueprint not found', 404);
    return jsonOk({ blueprint });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { id } = await ctx.params;
  try {
    const ok = await deleteBlueprintForUser(id, auth.user.id);
    if (!ok) return jsonError('NOT_FOUND', 'Blueprint not found', 404);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleUnexpected(err);
  }
}

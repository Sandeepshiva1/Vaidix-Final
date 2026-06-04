// W6.11 — Switch the authenticated user's active program.
//
// POST /api/me/active-program  body: { programId: string }
//
// Validates membership inside program-service (the source of truth — never
// trust the client to claim a program they don't belong to), updates
// users.activeProgramId, and returns the refreshed { programs, activeProgramId }
// payload so the client can call NextAuth's session.update() to refresh the
// JWT cookie without a full sign-in cycle.

import { z } from 'zod';
import {
  jsonOk,
  jsonError,
  requireAuth,
  requireCsrf,
  parseBody,
  handleUnexpected,
} from '@/server/services/api-helpers';
import {
  setActiveProgram,
  ProgramAccessError,
  loadProgramsForUser,
} from '@/server/services/program-service';
import { audit, extractRequestMetadata } from '@/server/services/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const switchSchema = z.object({
  programId: z.string().cuid('Invalid programId').or(z.string().min(8).max(64)),
});

export async function GET() {
  // Lets the switcher hydrate without waiting for a session refresh — useful
  // when memberships change between sign-in and now.
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const data = await loadProgramsForUser(gate.user.id);
    return jsonOk(data);
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;

    const body = await parseBody(req, switchSchema);
    if (!body.ok) return body.response;

    const result = await setActiveProgram(gate.user.id, body.data.programId);

    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: 'user.active_program.changed',
      entityType: 'user',
      entityId: gate.user.id,
      summary: `Switched active program`,
      details: { programId: body.data.programId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return jsonOk(result);
  } catch (err) {
    if (err instanceof ProgramAccessError) {
      const status = err.code === 'NOT_A_MEMBER' ? 403 : 404;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

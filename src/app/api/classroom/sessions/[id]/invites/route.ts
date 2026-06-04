// ════════════════════════════════════════════════════════════════════════════
// GET/POST /api/classroom/sessions/[id]/invites
// ════════════════════════════════════════════════════════════════════════════
// Invite management for INVITE_ONLY sessions.
//   GET  — list current invitees (host / proposer / admin only)
//   POST — add one or more invitees (idempotent, drops inactive/missing users)

import {
  jsonOk,
  jsonError,
  parseBody,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import {
  listSessionInvitees,
  addSessionInvitees,
} from '@/server/services/session-service';
import { addSessionInviteesSchema } from '@/lib/validation/session';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const invitees = await listSessionInvitees(id, gate.user.id, gate.user.role);
    return jsonOk({ invitees });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_INVITE_ONLY') return jsonError('NOT_INVITE_ONLY', 'Session is not INVITE_ONLY', 409);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host, proposer, or admin may manage invites', 403);
    return handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const body = await parseBody(req, addSessionInviteesSchema);
    if (!body.ok) return body.response;

    const { id } = await ctx.params;
    const result = await addSessionInvitees(id, body.data.userIds, gate.user.id, gate.user.role);
    return jsonOk(result, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
    if (msg === 'NOT_INVITE_ONLY') return jsonError('NOT_INVITE_ONLY', 'Session is not INVITE_ONLY', 409);
    if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Only host, proposer, or admin may manage invites', 403);
    return handleUnexpected(err);
  }
}

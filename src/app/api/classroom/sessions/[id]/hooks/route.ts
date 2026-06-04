// /api/classroom/sessions/[id]/hooks
// POST: faculty creates a hook (T/F, poll, dilemma, etc.)
// GET: list hooks (?onlyFired=true&sinceMs=…) — used by both faculty and learners

import { z } from 'zod';
import { LiveHookKind } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  parseQuery,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  createHook,
  listLiveHooks,
  userCanCreateHook,
} from '@/server/services/hooks/hooks-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const createSchema = z.object({
  kind: z.nativeEnum(LiveHookKind),
  prompt: z.string().min(1).max(1000),
  options: z.array(z.string().min(1)).max(8).optional(),
  correctOption: z.string().optional(),
  explanation: z.string().max(2000).optional(),
  intervalSeconds: z.number().int().positive().max(7200).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const listSchema = z.object({
  onlyFired: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  // W9.4 — `prePublished=true` returns only pre-session-published polls
  // (resident view). `prePublished=false` returns drafts only (host view).
  // Omitted = no filter applied on the pre-publish dimension.
  prePublished: z
    .union([z.literal('true'), z.literal('false')])
    .optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const { id: sessionId } = await ctx.params;

  const allowed = await userCanCreateHook(sessionId, auth.user.id, auth.user.role);
  if (!allowed) return jsonError('FORBIDDEN', 'Only host/PD/admin can create hooks', 403);

  const rl = await checkRateLimit({ bucket: `hook-create:${auth.user.id}`, ...LIMITS.HOOK_CREATE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Too many hooks created — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const hook = await createHook({
      sessionId,
      createdById: auth.user.id,
      kind: body.data.kind,
      prompt: body.data.prompt,
      options: body.data.options,
      correctOption: body.data.correctOption,
      explanation: body.data.explanation,
      intervalSeconds: body.data.intervalSeconds,
      scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : undefined,
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.LIVE_HOOK_CREATED,
      entityType: 'LiveHook',
      entityId: hook.id,
      summary: `Hook ${body.data.kind} created in session ${sessionId}`,
      details: { sessionId, kind: body.data.kind },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ hook }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const q = await parseQuery(req, listSchema);
  if (!q.ok) return q.response;
  const { id: sessionId } = await ctx.params;
  try {
    const prePublished =
      q.data.prePublished === 'true' ? true
      : q.data.prePublished === 'false' ? false
      : undefined;
    const hooks = await listLiveHooks(sessionId, {
      onlyFired: q.data.onlyFired,
      sinceMs: q.data.sinceMs,
      prePublished,
    });
    return jsonOk({ hooks });
  } catch (err) {
    return handleUnexpected(err);
  }
}

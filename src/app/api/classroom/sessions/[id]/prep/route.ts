// PATCH /api/classroom/sessions/[id]/prep
// Lightweight endpoint for the Study Hub prep panel to update objectives,
// prereqItems (stored in metadata.prereqItems) and doubtPrompts (stored in
// metadata.doubtPrompts) without touching schedule fields. The validation
// schemas are kept here rather than in a shared validation module so the
// shape change history is co-located with the route.

import { z } from 'zod';
import {
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

const objectiveSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(3).max(280),
  blooms: z.number().int().min(1).max(6),
  epaTag: z.string().max(40).nullable().optional(),
});

const prereqItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(2).max(300),
  required: z.boolean(),
});

// W9.3 — presenter-published "doubt prompts" that frame what residents ask
// before the session. Stored in session.metadata.doubtPrompts (same JSON
// column prereqItems live in) — no new model, no migration.
const doubtPromptSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(3).max(200),
});

const schema = z.object({
  objectives: z.array(objectiveSchema).max(10).optional(),
  prereqItems: z.array(prereqItemSchema).max(20).optional(),
  doubtPrompts: z.array(doubtPromptSchema).max(3).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const { id: sessionId } = await ctx.params;

  const session = await db.teachingSession.findUnique({
    where: { id: sessionId, deletedAt: null },
    select: { hostId: true, proposedBy: true, metadata: true },
  });
  if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);

  const isAdmin =
    auth.user.role === Role.ADMIN || auth.user.role === Role.PROGRAM_DIRECTOR;
  const isHost =
    auth.user.id === session.hostId || auth.user.id === session.proposedBy;
  if (!isHost && !isAdmin)
    return jsonError('FORBIDDEN', 'Only host/admin can update prep', 403);

  const update: Record<string, unknown> = {};

  if (body.data.objectives !== undefined) {
    update.objectives = body.data.objectives;
  }

  // prereqItems and doubtPrompts both live in session.metadata. Merge with
  // any existing metadata + with each other so the same PATCH can update
  // either independently without dropping the other.
  if (body.data.prereqItems !== undefined || body.data.doubtPrompts !== undefined) {
    const currentMeta =
      (update.metadata as Record<string, unknown> | undefined) ??
      ((session.metadata ?? {}) as Record<string, unknown>);
    const nextMeta: Record<string, unknown> = { ...currentMeta };
    if (body.data.prereqItems !== undefined) nextMeta.prereqItems = body.data.prereqItems;
    if (body.data.doubtPrompts !== undefined) nextMeta.doubtPrompts = body.data.doubtPrompts;
    update.metadata = nextMeta;
  }

  const updated = await db.teachingSession.update({
    where: { id: sessionId },
    data: update,
    select: { objectives: true, metadata: true },
  });

  // Audit the prompt-publish action separately so faculty can later show a
  // "X prompts published Y minutes ago" indicator. Objectives + prereqs are
  // higher-frequency edits and stay quiet to avoid log noise.
  if (body.data.doubtPrompts !== undefined) {
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.PRE_QUESTION_PROMPTS_UPDATED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: `Published ${body.data.doubtPrompts.length} doubt prompt${body.data.doubtPrompts.length === 1 ? '' : 's'}`,
      details: { count: body.data.doubtPrompts.length },
      ...extractRequestMetadata(req),
    });
  }

  return jsonOk({ objectives: updated.objectives, metadata: updated.metadata });
}

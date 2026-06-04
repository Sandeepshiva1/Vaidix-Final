// list topics, optionally filtered by subspecialty.
// POST: faculty/PD/admin can create topics on the fly from the
// schedule-session wizard (and other surfaces) without an admin trip.
import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  requireAuthWithProgram,
  handleUnexpected,
  parseQuery,
  parseBody,
} from '@/server/services/api-helpers';
import {
  listTopics,
  createTopic,
  TopicError,
} from '@/server/services/topics/topics-service';

const querySchema = z.object({
  subspecialty: z.string().trim().min(1).max(40).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  subspecialty: z.string().trim().min(1).max(40).optional(),
});

export async function GET(req: Request) {
  try {
    // topic curriculum is per-program.
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const q = await parseQuery(req, querySchema);
    if (!q.ok) return q.response;
    const items = await listTopics({
      programId: gate.user.activeProgramId,
      subspecialty: q.data.subspecialty,
    });
    return jsonOk({ items });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    if (
      gate.user.role !== Role.FACULTY &&
      gate.user.role !== Role.PROGRAM_DIRECTOR &&
      gate.user.role !== Role.ADMIN
    ) {
      return jsonError('FORBIDDEN', 'Only faculty, PD, or admin can create topics', 403);
    }
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;
    const topic = await createTopic(body.data, gate.user.activeProgramId);
    return jsonOk({ topic }, { status: 201 });
  } catch (err) {
    if (err instanceof TopicError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}

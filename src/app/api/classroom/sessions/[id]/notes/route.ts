// GET  /api/classroom/sessions/[id]/notes
//   Returns the SharedNote (creating an empty one on first read) plus the
//   replay edit log so the recording-viewer can scrub through history.
//
// POST /api/classroom/sessions/[id]/notes
//   Appends a new edit. Last-writer-wins with optimistic concurrency:
//   the client sends `expectedVersion` and the server bumps to
//   `expectedVersion + 1`. A version mismatch returns 409 with the current
//   snapshot so the client can rebase. Each accepted edit also writes a
//   NOTE_EDIT beacon to SessionAuditEvent for replay.
//
// Edit permissions: HOST and CO_HOST always; PARTICIPANT only when
// SharedNote.editableByResidents = true.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import {
  computeTMs,
  SESSION_AUDIT,
  sessionAudit,
} from '@/server/services/session-audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const writeSchema = z.object({
  // Full replacement content. Kept as an opaque string — markdown/plain
  // both work, the client renders it back as it likes. Capped at 64KB to
  // keep one row reasonable; longer notes need to be split into a doc.
  content: z.string().max(64 * 1024),
  expectedVersion: z.number().int().min(0),
  // Optional structured diff for replay UX. The recording-viewer can show
  // "Sandeep added: ..." vs the full snapshot scrub. Free-form Json so the
  // client can choose its diff format (line-diff, char-diff, etc.).
  delta: z.record(z.string(), z.unknown()).optional(),
  editableByResidents: z.boolean().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const { id: sessionId } = await ctx.params;
    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    let note = await db.sharedNote.findUnique({
      where: { sessionId },
      include: {
        edits: {
          orderBy: { version: 'asc' },
          select: { version: true, authorId: true, createdAt: true },
        },
      },
    });
    if (!note) {
      note = await db.sharedNote.create({
        data: { sessionId, content: '', version: 0 },
        include: {
          edits: {
            orderBy: { version: 'asc' },
            select: { version: true, authorId: true, createdAt: true },
          },
        },
      });
    }
    return jsonOk({
      note: {
        id: note.id,
        content: note.content,
        version: note.version,
        editableByResidents: note.editableByResidents,
        edits: note.edits,
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const body = await parseBody(req, writeSchema);
    if (!body.ok) return body.response;
    const { id: sessionId } = await ctx.params;

    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    const rl = await checkRateLimit({
      bucket: `shared-note:${auth.user.id}`,
      ...LIMITS.SHARED_NOTE_WRITE,
    });
    if (!rl.allowed) {
      return jsonError('RATE_LIMITED', 'Note edit rate exceeded', 429, {
        resetAt: rl.resetAt.toISOString(),
      });
    }

    const note =
      (await db.sharedNote.findUnique({ where: { sessionId } })) ??
      (await db.sharedNote.create({ data: { sessionId, content: '', version: 0 } }));

    const isHost = role === 'HOST' || role === 'CO_HOST';
    if (!isHost && !note.editableByResidents) {
      return jsonError('FORBIDDEN', 'Only the host can edit this note', 403);
    }

    if (body.data.expectedVersion !== note.version) {
      return jsonError(
        'VERSION_CONFLICT',
        'Note was edited by someone else — refresh and retry',
        409,
        { currentVersion: note.version, currentContent: note.content }
      );
    }

    const nextVersion = note.version + 1;
    // Update editableByResidents toggle is a host-only action; we silently
    // ignore the field for non-host writers rather than 403 — keeps the
    // common case (a resident saving content) working without ceremony.
    const editableUpdate =
      isHost && body.data.editableByResidents !== undefined
        ? { editableByResidents: body.data.editableByResidents }
        : {};

    const [updated] = await db.$transaction([
      db.sharedNote.update({
        where: { sessionId },
        data: {
          content: body.data.content,
          version: nextVersion,
          ...editableUpdate,
        },
      }),
      db.sharedNoteEdit.create({
        data: {
          noteId: note.id,
          authorId: auth.user.id,
          version: nextVersion,
          delta: (body.data.delta ?? {}) as object,
          snapshot: body.data.content,
        },
      }),
    ]);

    // Replay beacon — content lives in SharedNoteEdit, the audit row just
    // pegs the timeline so the recording-viewer can fetch the matching edit.
    const tMs = await computeTMs(sessionId);
    await sessionAudit({
      sessionId,
      eventType: SESSION_AUDIT.NOTE_EDIT,
      actorId: auth.user.id,
      details: { noteId: note.id, version: nextVersion },
      tMs,
    });

    return jsonOk({
      note: {
        id: updated.id,
        content: updated.content,
        version: updated.version,
        editableByResidents: updated.editableByResidents,
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

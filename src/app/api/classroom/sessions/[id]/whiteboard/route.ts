// GET  /api/classroom/sessions/[id]/whiteboard
//   Returns the latest snapshot (or { snapshot: null } for a fresh
//   whiteboard) so a late joiner can hydrate their tldraw store. Optionally
//   accepts ?history=1 to also return all snapshots ordered by tMs for the
//   recording-viewer scrub.
//
// POST /api/classroom/sessions/[id]/whiteboard
//   Persists a new snapshot. Bumps the parent Whiteboard.updatedAt and
//   writes a WHITEBOARD_OP-style audit beacon... actually we reuse
//   SessionAuditEvent only for cross-stream replay; the snapshot itself
//   carries its own tMs so we don't need a separate audit row. Tracking
//   beacon stays out of the audit table.
//
// Edit permissions: HOST/CO_HOST always; PARTICIPANT only when
// Whiteboard.editableByResidents = true.

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
import { computeTMs } from '@/server/services/session-audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const writeSchema = z.object({
  snapshot: z.unknown(), // tldraw store snapshot — opaque to the server
  editableByResidents: z.boolean().optional(),
});

/**
 * Tldraw snapshots get large fast. We cap at 2MB to keep DB rows reasonable
 * — anything bigger probably means the host pasted a wallpaper-sized image
 * onto the canvas, which we'd rather reject than silently ingest.
 */
const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const { id: sessionId } = await ctx.params;
    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    const url = new URL(req.url);
    const includeHistory = url.searchParams.get('history') === '1';

    const board = await db.whiteboard.findUnique({ where: { sessionId } });
    if (!board) {
      return jsonOk({
        whiteboard: null,
        snapshot: null,
        editableByResidents: false,
        ...(includeHistory ? { history: [] } : {}),
      });
    }

    const latest = await db.whiteboardSnapshot.findFirst({
      where: { whiteboardId: board.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, snapshot: true, tMs: true, createdAt: true, authorId: true },
    });

    let history: { id: string; tMs: number | null; createdAt: Date; authorId: string }[] = [];
    if (includeHistory) {
      // Recording-viewer scrub: return all snapshots without the heavy
      // `snapshot` blob. The viewer GETs /whiteboard/snapshots/[id] when it
      // wants to load a specific frame.
      history = await db.whiteboardSnapshot.findMany({
        where: { whiteboardId: board.id, tMs: { not: null } },
        orderBy: [{ tMs: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, tMs: true, createdAt: true, authorId: true },
      });
    }

    return jsonOk({
      whiteboard: {
        id: board.id,
        editableByResidents: board.editableByResidents,
      },
      snapshot: latest?.snapshot ?? null,
      latestSnapshotId: latest?.id ?? null,
      ...(includeHistory ? { history } : {}),
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

    // Size guard — `JSON.stringify` is the fairest measurement of what we'll
    // actually persist. We do this before the rate-limit hit so a single
    // oversize attempt doesn't burn the bucket.
    const serialised = JSON.stringify(body.data.snapshot);
    if (serialised.length > SNAPSHOT_MAX_BYTES) {
      return jsonError(
        'PAYLOAD_TOO_LARGE',
        `Snapshot exceeds ${SNAPSHOT_MAX_BYTES} bytes`,
        413
      );
    }

    const rl = await checkRateLimit({
      bucket: `whiteboard:${auth.user.id}`,
      ...LIMITS.SHARED_NOTE_WRITE, // same envelope: ~120/min/user
    });
    if (!rl.allowed) {
      return jsonError('RATE_LIMITED', 'Whiteboard write rate exceeded', 429, {
        resetAt: rl.resetAt.toISOString(),
      });
    }

    const board =
      (await db.whiteboard.findUnique({ where: { sessionId } })) ??
      (await db.whiteboard.create({ data: { sessionId } }));

    const isHost = role === 'HOST' || role === 'CO_HOST';
    if (!isHost && !board.editableByResidents) {
      return jsonError('FORBIDDEN', 'Only the host can edit this whiteboard', 403);
    }

    // Edit-permission toggle: host-only, silently ignored for non-host writers.
    const editableUpdate =
      isHost && body.data.editableByResidents !== undefined
        ? { editableByResidents: body.data.editableByResidents }
        : {};

    const tMs = await computeTMs(sessionId);
    const [updatedBoard, snap] = await db.$transaction([
      db.whiteboard.update({
        where: { id: board.id },
        data: { ...editableUpdate, updatedAt: new Date() },
      }),
      db.whiteboardSnapshot.create({
        data: {
          whiteboardId: board.id,
          authorId: auth.user.id,
          snapshot: body.data.snapshot as object,
          tMs,
        },
      }),
    ]);

    return jsonOk({
      whiteboard: {
        id: updatedBoard.id,
        editableByResidents: updatedBoard.editableByResidents,
      },
      latestSnapshotId: snap.id,
      tMs: snap.tMs,
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

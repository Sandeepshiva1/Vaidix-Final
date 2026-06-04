// Breakout Agent ingest endpoint
// Wire contract for the AI Discussion Co-Facilitator (Python sidecar).
// See docs/BREAKOUT-AGENT-CONTRACT.md.
//
// Auth: shared bearer secret in env BREAKOUT_AGENT_INGEST_SECRET.
// (Mirrors the LIVE_CAPTIONS_INGEST_SECRET pattern.)

import { z } from 'zod';
import { BreakoutAgentLogKind } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  handleUnexpected,
  parseBody,
} from '@/server/services/api-helpers';
import {
  ingestAgentLog,
  BreakoutError,
} from '@/server/services/breakouts/breakout-service';
import { audit, AUDIT_EVENTS } from '@/server/services/audit';
import { mapBreakoutError } from '../../../route';

const schema = z.object({
  kind: z.nativeEnum(BreakoutAgentLogKind),
  content: z.string().trim().min(1).max(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function checkBearer(req: Request): boolean {
  const expected = process.env.BREAKOUT_AGENT_INGEST_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match) return false;
  // Constant-time-ish compare via length + char-by-char (small string).
  const provided = match[1];
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; breakoutId: string }> }
) {
  try {
    if (!checkBearer(req)) {
      return jsonError('UNAUTHORIZED', 'Invalid or missing bearer token', 401);
    }
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const { breakoutId } = await ctx.params;
    const created = await ingestAgentLog({
      breakoutId,
      kind: body.data.kind,
      content: body.data.content,
      metadata: body.data.metadata,
    });
    await audit({
      eventType: AUDIT_EVENTS.BREAKOUT_AGENT_LOG_INGESTED,
      entityType: 'BreakoutAgentLog',
      entityId: created.id,
      details: { breakoutId, kind: body.data.kind },
    });
    return jsonOk({ id: created.id }, { status: 201 });
  } catch (err) {
    if (err instanceof BreakoutError) {
      const mapped = mapBreakoutError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}

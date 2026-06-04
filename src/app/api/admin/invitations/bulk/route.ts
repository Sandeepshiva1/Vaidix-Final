// ════════════════════════════════════════════════════════════════════════════
// Bulk-create invitations from an Excel upload (admin only)
// ════════════════════════════════════════════════════════════════════════════
// Thin wrapper around createInvitation() — loops over each row, captures
// per-row errors, and returns a results manifest the UI can render. Rate-
// limited as ONE unit per batch (NOT per row) so a 200-row upload counts
// the same as a 5-row upload against BULK_INVITATION_CREATE.
//
// Why a separate endpoint: POST /api/invitations is rate-limited at 30/hour
// per admin (sensitive: outbound mail), which forbids real bulk imports.
// This route uses its own bucket sized for batches and caps each batch at
// 500 rows — total fan-out remains bounded.

import { Role } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  parseBody,
  requireRole,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { createInvitation } from '@/server/services/invitation-service';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';
import { bulkCreateInvitationsSchema } from '@/lib/validation/auth';

interface RowResult {
  row: number;
  email: string;
  status: 'ok' | 'error';
  invitationId?: string;
  error?: { code: string; message: string };
}

// Map createInvitation()'s thrown error.message values to admin-friendly
// strings. Anything not in the map is reported as 'UNEXPECTED' so the UI
// can still render a row instead of failing the whole batch.
const ERROR_MESSAGES: Record<string, string> = {
  USER_EXISTS: 'A user with this email already exists',
  PENDING_INVITE_EXISTS: 'A pending invitation already exists for this email',
  MOBILE_EXISTS: 'A user with this mobile number already has an account — they can log in without a new invitation',
  MOBILE_INVITE_EXISTS: 'A pending invitation already uses this mobile number — only one invitation per mobile is allowed',
  INVALID_PD: 'Selected program director was not found or is not a Program Director',
  INVALID_MENTOR: 'Selected faculty mentor was not found or is not Faculty',
  INVALID_COHORT: 'Selected cohort no longer exists',
};

export async function POST(req: Request) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const rl = await checkRateLimit({
      bucket: `invite-bulk:${gate.user.id}`,
      ...LIMITS.BULK_INVITATION_CREATE,
    });
    if (!rl.allowed) {
      return jsonError(
        'RATE_LIMITED',
        'Bulk-invite rate limit reached. Try again in an hour.',
        429,
      );
    }

    const parsed = await parseBody(req, bulkCreateInvitationsSchema);
    if (!parsed.ok) return parsed.response;

    const results: RowResult[] = [];
    let okCount = 0;
    let errCount = 0;

    // Sequential — keeps audit + email side-effects ordered, lets a single
    // misbehaving row fail loudly without aborting the rest, and avoids
    // hammering SMTP. createInvitation throws specific Error.message strings
    // for known business-rule violations; everything else falls to UNEXPECTED.
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const row = parsed.data.rows[i];
      try {
        const invitation = await createInvitation({
          ...row,
          invitedById: gate.user.id,
          invitedByName: gate.user.name,
        });
        results.push({
          row: i + 1,
          email: row.email,
          status: 'ok',
          invitationId: invitation.id,
        });
        okCount += 1;
      } catch (err) {
        const code = err instanceof Error ? err.message : 'UNEXPECTED';
        const message = ERROR_MESSAGES[code] ?? 'Unexpected error while creating invitation';
        if (!ERROR_MESSAGES[code]) {
          // Log the real error server-side so an operator can investigate;
          // the client gets a generic message to avoid leaking internals.
          console.error(`[bulk-invitations] row ${i + 1} (${row.email}) failed:`, err);
        }
        results.push({
          row: i + 1,
          email: row.email,
          status: 'error',
          error: { code: ERROR_MESSAGES[code] ? code : 'UNEXPECTED', message },
        });
        errCount += 1;
      }
    }

    return jsonOk({
      summary: { total: results.length, ok: okCount, error: errCount },
      results,
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

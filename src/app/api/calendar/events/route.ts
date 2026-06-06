import { jsonOk, jsonError, requireAuth, parseQuery, handleUnexpected } from '@/server/services/api-helpers';
import { listCalendarEvents } from '@/server/services/calendar-service';
import { calendarQuerySchema } from '@/lib/validation/session';
import { db } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    // Read activeProgramId live from DB — same pattern as the dashboard page.
    // requireAuthWithProgram() returned 409 when activeProgramId was null/stale
    // in the DB, but the dashboard gracefully omits the programId filter in that
    // case and still shows sessions. Mirror that here so the calendar is
    // consistent with the dashboard session list.
    const userRow = await db.user.findUnique({
      where: { id: gate.user.id },
      select: { activeProgramId: true },
    });
    const activeProgramId = userRow?.activeProgramId ?? gate.user.activeProgramId ?? null;

    const q = await parseQuery(req, calendarQuerySchema);
    if (!q.ok) return q.response;

    const from = new Date(q.data.from);
    const to = new Date(q.data.to);
    if (to <= from) return jsonError('INVALID_RANGE', '`to` must be after `from`', 400);
    if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      return jsonError('RANGE_TOO_LARGE', 'Range cannot exceed 1 year', 400);
    }

    const events = await listCalendarEvents(
      gate.user.id,
      gate.user.role,
      from,
      to,
      activeProgramId ?? undefined,
    );
    return jsonOk({ events });
  } catch (err) {
    console.error('[GET /api/calendar/events] failed:', err);
    return handleUnexpected(err);
  }
}

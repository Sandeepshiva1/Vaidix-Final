// ════════════════════════════════════════════════════════════════════════════
// Session Reminder Scheduler — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Enqueues delayed BullMQ jobs for 24h + 15min session reminders.
// Jobs are idempotent by id (`${sessionId}:24h` / `${sessionId}:15min`) so that
// re-scheduling the same session replaces the old jobs cleanly.

import { getQueue, QUEUES } from '@/lib/queue';
import { db } from '@/lib/db';
import { SessionApprovalStatus, SessionStatus } from '@prisma/client';

export const REMINDER_LEAD_MS = {
  H24: 24 * 60 * 60 * 1000,
  MIN15: 15 * 60 * 1000,
} as const;

export type ReminderLead = '24H' | '15MIN';

export interface ReminderJobData {
  sessionId: string;
  leadTime: ReminderLead;
}

function jobIdFor(sessionId: string, lead: ReminderLead): string {
  // BullMQ rejects ':' in custom job IDs. Use '-' as separator.
  return `session-${sessionId}-${lead}`;
}

export async function cancelSessionReminders(sessionId: string): Promise<void> {
  const queue = getQueue(QUEUES.REMINDER);
  await Promise.all([
    queue.remove(jobIdFor(sessionId, '24H')).catch(() => undefined),
    queue.remove(jobIdFor(sessionId, '15MIN')).catch(() => undefined),
  ]);
}

export async function scheduleSessionReminders(sessionId: string): Promise<void> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      approvalStatus: true,
      scheduledStart: true,
    },
  });
  if (!session) return;
  if (session.approvalStatus !== SessionApprovalStatus.APPROVED) return;
  if (session.status === SessionStatus.CANCELLED || session.status === SessionStatus.ENDED) return;

  // Drain first so re-scheduling replaces any stale job.
  await cancelSessionReminders(sessionId);

  const queue = getQueue(QUEUES.REMINDER);
  const startMs = session.scheduledStart.getTime();
  const now = Date.now();

  const plan: Array<{ lead: ReminderLead; delayMs: number }> = [
    { lead: '24H', delayMs: startMs - REMINDER_LEAD_MS.H24 - now },
    { lead: '15MIN', delayMs: startMs - REMINDER_LEAD_MS.MIN15 - now },
  ];

  for (const { lead, delayMs } of plan) {
    // Skip any reminder whose lead-time has already passed — sessions scheduled
    // less than N time in advance shouldn't get a retroactive reminder.
    if (delayMs <= 0) continue;
    await queue.add(
      'session-reminder',
      { sessionId, leadTime: lead } satisfies ReminderJobData,
      {
        jobId: jobIdFor(sessionId, lead),
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
      }
    );
  }
}

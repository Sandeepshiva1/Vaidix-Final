// ════════════════════════════════════════════════════════════════════════════
// Session Reminder Worker — runs in its own tsx process, NOT in Next.js
// ════════════════════════════════════════════════════════════════════════════
// Drains the `session-reminder` BullMQ queue and fires 24h / 15min emails to
// all session attendees. Invoked from src/server/workers/index.ts.

import { createWorker, QUEUES } from '@/lib/queue';
import { notifySessionReminder } from '@/server/services/session-notifications';
import type { ReminderJobData } from '@/server/services/reminder-scheduler';

export function startReminderWorker() {
  const worker = createWorker<ReminderJobData>(
    QUEUES.REMINDER,
    async (job) => {
      const { sessionId, leadTime } = job.data;
      await notifySessionReminder(sessionId, leadTime);
      return { sessionId, leadTime, sentAt: new Date().toISOString() };
    },
    { concurrency: 4 }
  );

  worker.on('failed', (job, err) => {
    console.error('[reminder-worker] job failed', {
      id: job?.id,
      data: job?.data,
      err: err.message,
    });
  });
  worker.on('completed', (job) => {
    console.log('[reminder-worker] sent', { id: job.id, ...job.data });
  });

  return worker;
}

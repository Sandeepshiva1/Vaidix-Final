// security hardening — list jobs in every critical DLQ.
// Admin/PD only. Used by the on-call surface when a recording/transcript
// failed to land or when a reminder didn't fire.

import { Queue } from 'bullmq';
import { Role } from '@prisma/client';
import { jsonOk, requireRole, handleUnexpected } from '@/server/services/api-helpers';
import { CRITICAL_QUEUES, dlqOf } from '@/lib/queue';
import { makeRedisConnection } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const gate = await requireRole(Role.ADMIN, Role.PROGRAM_DIRECTOR);
    if (!gate.ok) return gate.response;

    const items: Array<{
      queue: string;
      jobId: string;
      sourceJobId?: string;
      data: unknown;
      failedReason?: string;
      attemptsMade?: number;
      failedAt?: string;
      timestamp: number;
    }> = [];

    for (const name of CRITICAL_QUEUES) {
      const q = new Queue(dlqOf(name), { connection: makeRedisConnection() });
      try {
        // Newest first, cap at 50/queue.
        const jobs = await q.getJobs(['waiting', 'delayed', 'failed'], 0, 49);
        for (const j of jobs) {
          items.push({
            queue: name,
            jobId: String(j.id),
            sourceJobId: (j.data as { sourceJobId?: string })?.sourceJobId,
            data: (j.data as { data?: unknown })?.data,
            failedReason: (j.data as { failedReason?: string })?.failedReason,
            attemptsMade: (j.data as { attemptsMade?: number })?.attemptsMade,
            failedAt: (j.data as { failedAt?: string })?.failedAt,
            timestamp: j.timestamp,
          });
        }
      } finally {
        await q.close();
      }
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    return jsonOk({ count: items.length, items });
  } catch (err) {
    return handleUnexpected(err);
  }
}

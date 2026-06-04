// ════════════════════════════════════════════════════════════════════════════
// WhatsApp Pearl Worker
// ════════════════════════════════════════════════════════════════════════════
// Co-tenant of the EMAIL queue (one queue, multiple kinds). At dispatch we
// branch on `data.kind`. A dedicated WHATSAPP queue can be split off in a later phase.

import { createWorker, QUEUES } from '@/lib/queue';
import { sendWhatsappPearl } from '@/server/services/whatsapp/whatsapp-service';

interface WhatsappPearlJob {
  kind: 'whatsapp.pearl';
  userId: string;
  templateKind: 'PEARL' | 'PEARL_CASE';
  payload: {
    pearlId: string;
    title: string;
    body: string;
    imageUrl?: string;
    spacedDay: 1 | 3 | 7;
  };
}

type EmailQueueJob = WhatsappPearlJob | { kind: string };

export function startWhatsappWorker() {
  const worker = createWorker<EmailQueueJob>(
    QUEUES.EMAIL,
    async (job) => {
      if (job.data.kind !== 'whatsapp.pearl') {
        // Other kinds (transactional emails) are handled elsewhere; ignore here.
        return { skipped: true };
      }
      const data = job.data as WhatsappPearlJob;
      const result = await sendWhatsappPearl({
        userId: data.userId,
        templateKind: data.templateKind,
        payload: data.payload,
      });
      return { delivered: result.delivered, reason: result.reason };
    },
    { concurrency: 4 }
  );

  worker.on('failed', (job, err) => {
    console.error('[whatsapp-worker] job failed', { id: job?.id, err: err.message });
  });
  worker.on('completed', (job, result) => {
    console.log('[whatsapp-worker] done', { id: job.id, result });
  });
  return worker;
}

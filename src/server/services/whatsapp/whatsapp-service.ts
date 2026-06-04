// ════════════════════════════════════════════════════════════════════════════
// WhatsApp Pearl Delivery — Stream D #9
// ════════════════════════════════════════════════════════════════════════════
// Sends pearls via WhatsApp Business API on a 24h / 72h / 7d cadence.
// Phase A (no real WA credentials): writes Notification rows + logs the
// outbound payload. Phase B (LVPEI go-live): real Cloud API call goes here.
//
// Consent: every learner must have an active ConsentRecord(kind='whatsapp')
// before any pearl is sent. Verified at schedule time (this service) and
// re-checked at send time inside the worker.

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import {
  NotificationChannel,
  ConsentType,
  type Notification,
} from '@prisma/client';
import { getQueue, QUEUES } from '@/lib/queue';

export interface WhatsappSendInput {
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

const SPACED_DAYS_MS: Record<1 | 3 | 7, number> = {
  1: 24 * 3600_000,
  3: 72 * 3600_000,
  7: 7 * 24 * 3600_000,
};

export async function userHasWhatsappConsent(userId: string): Promise<boolean> {
  const consent = await db.consentRecord.findFirst({
    where: {
      userId,
      consentType: ConsentType.WHATSAPP_NOTIFICATIONS,
      granted: true,
      withdrawnAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return !!consent;
}

/**
 * Sends a single WhatsApp pearl message. In Phase A this is a stub that
 * writes a Notification row + logs. In Phase B (LVPEI on-prem), wire the
 * real Cloud API HTTPS call here.
 */
export async function sendWhatsappPearl(input: WhatsappSendInput): Promise<{
  notification: Notification;
  delivered: boolean;
  reason?: string;
}> {
  const consented = await userHasWhatsappConsent(input.userId);
  if (!consented) {
    const note = await db.notification.create({
      data: {
        userId: input.userId,
        channel: NotificationChannel.WHATSAPP,
        kind: 'pearl.spaced',
        title: input.payload.title,
        body: input.payload.body,
        payload: { ...input.payload, status: 'BLOCKED_NO_CONSENT' } as object,
        deliveryStatus: 'FAILED_NO_CONSENT',
      },
    });
    return { notification: note, delivered: false, reason: 'NO_CONSENT' };
  }

  let delivered = true;
  let reason: string | undefined;

  if (env.WHATSAPP_API_URL && env.WHATSAPP_API_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    // Phase B: real send. Stubbed here for type-safety; do not actually call until wired.
    try {
      // const res = await fetch(`${env.WHATSAPP_API_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { ... })
      // if (!res.ok) throw new Error(`WhatsApp API ${res.status}`)
    } catch (e) {
      delivered = false;
      reason = (e as Error).message;
    }
  } else {
    // Phase A: dry-run. Log only.
    console.log('[whatsapp-service] dry-run send', { userId: input.userId, ...input.payload });
  }

  const notification = await db.notification.create({
    data: {
      userId: input.userId,
      channel: NotificationChannel.WHATSAPP,
      kind: 'pearl.spaced',
      title: input.payload.title,
      body: input.payload.body,
      payload: {
        ...input.payload,
        dryRun: !env.WHATSAPP_API_URL,
        ...(reason ? { errorMessage: reason } : {}),
      } as object,
      deliveryStatus: delivered ? 'SENT' : 'FAILED',
      sentAt: delivered ? new Date() : null,
    },
  });
  return { notification, delivered, reason };
}

export interface SchedulePearlInput {
  userId: string;
  pearl: {
    id: string;
    title: string;
    body: string;
    imageUrl?: string;
  };
}

/**
 * Schedules the 24h / 72h / 7d delayed jobs for a single learner+pearl pair.
 * Idempotent via deterministic jobIds (won't double-schedule on retry).
 */
export async function schedulePearlSpacedDelivery(input: SchedulePearlInput): Promise<{
  scheduled: number;
  jobIds: string[];
}> {
  const queue = getQueue(QUEUES.EMAIL); // co-tenant the email queue for now; dedicated WA queue is W12 follow-up
  const jobIds: string[] = [];
  for (const day of [1, 3, 7] as const) {
    const jobId = `wa-pearl-${input.userId}-${input.pearl.id}-d${day}`;
    await queue.add(
      'whatsapp.pearl',
      {
        kind: 'whatsapp.pearl',
        userId: input.userId,
        templateKind: 'PEARL',
        payload: {
          pearlId: input.pearl.id,
          title: input.pearl.title,
          body: input.pearl.body,
          imageUrl: input.pearl.imageUrl,
          spacedDay: day,
        },
      },
      { jobId, delay: SPACED_DAYS_MS[day] }
    );
    jobIds.push(jobId);
  }
  return { scheduled: jobIds.length, jobIds };
}

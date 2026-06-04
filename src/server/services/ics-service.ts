// ════════════════════════════════════════════════════════════════════════════
// ICS (iCalendar) Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Generates RFC 5545 .ics files for email attachment + subscribable feeds.

import { createEvents, createEvent, type EventAttributes, type DateArray } from 'ics';
import { env } from '@/lib/env';

function toDateArray(d: Date): DateArray {
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ];
}

export interface IcsSessionInput {
  id: string;
  title: string;
  description: string | null;
  start: Date;
  end: Date;
  host: { name: string; email: string };
  joinUrl: string;
  recurrenceRule: string | null;
  recurrenceUntil: Date | null;
  status: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  location?: string;
}

export function buildSessionIcs(input: IcsSessionInput): string {
  const recurrenceRule = input.recurrenceRule
    ? input.recurrenceUntil
      ? `${input.recurrenceRule};UNTIL=${input.recurrenceUntil
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}/, '')}`
      : input.recurrenceRule
    : undefined;

  const attrs: EventAttributes = {
    uid: `session-${input.id}@vaidix.lvpei.org`,
    title: input.title,
    description: input.description ?? '',
    start: toDateArray(input.start),
    startInputType: 'utc',
    end: toDateArray(input.end),
    endInputType: 'utc',
    url: input.joinUrl,
    location: input.location ?? input.joinUrl,
    status: input.status,
    organizer: { name: input.host.name, email: input.host.email },
    productId: 'vaidix/ics',
    calName: 'Vaidix Sessions',
    recurrenceRule,
    alarms: [
      { action: 'display', description: 'Reminder', trigger: { hours: 24, before: true } },
      { action: 'display', description: 'Reminder', trigger: { minutes: 15, before: true } },
    ],
  };

  const { error, value } = createEvent(attrs);
  if (error || !value) {
    throw new Error(`ICS_GENERATION_FAILED: ${error?.message ?? 'unknown'}`);
  }
  return value;
}

export function sessionJoinUrl(sessionId: string): string {
  const base = env.NEXTAUTH_URL.replace(/\/$/, '');
  return `${base}/classroom/${sessionId}`;
}

// ----------------------------------------------------------------------------
// Multi-event feed (subscribable iCal URL)
// ----------------------------------------------------------------------------
// Builds a single VCALENDAR with all upcoming + recently-past sessions for a
// user. Clients (Google Calendar / Outlook / Apple) poll this URL on their
// own schedule — usually every few hours.

export interface IcsFeedInput {
  calendarName: string;
  events: IcsSessionInput[];
}

export function buildUserFeedIcs(input: IcsFeedInput): string {
  const attrs: EventAttributes[] = input.events.map((e) => {
    const recurrenceRule = e.recurrenceRule
      ? e.recurrenceUntil
        ? `${e.recurrenceRule};UNTIL=${e.recurrenceUntil
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\.\d{3}/, '')}`
        : e.recurrenceRule
      : undefined;

    return {
      uid: `session-${e.id}@vaidix.lvpei.org`,
      title: e.title,
      description: e.description ?? '',
      start: toDateArray(e.start),
      startInputType: 'utc',
      end: toDateArray(e.end),
      endInputType: 'utc',
      url: e.joinUrl,
      location: e.location ?? e.joinUrl,
      status: e.status,
      organizer: { name: e.host.name, email: e.host.email },
      productId: 'vaidix/ics-feed',
      calName: input.calendarName,
      recurrenceRule,
      alarms: [
        { action: 'display', description: 'Reminder', trigger: { hours: 24, before: true } },
        { action: 'display', description: 'Reminder', trigger: { minutes: 15, before: true } },
      ],
    };
  });

  const { error, value } = createEvents(attrs);
  if (error || !value) {
    throw new Error(`ICS_FEED_FAILED: ${error?.message ?? 'unknown'}`);
  }
  return value;
}

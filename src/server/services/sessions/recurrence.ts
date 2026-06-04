import { rrulestr, type RRule } from 'rrule';

// Returns the next occurrence start at-or-after `now`, or null if the
// recurrence has fully completed. Mirrors the expansion logic in
// calendar-service so listings, detail pages, and the calendar agree on
// what's "upcoming" for a recurring session.
export function nextOccurrenceStart(
  scheduledStart: Date,
  recurrenceRule: string,
  recurrenceUntil: Date | null,
  now: Date,
): Date | null {
  const dtstart = scheduledStart
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  let rule: RRule;
  try {
    rule = rrulestr(`DTSTART:${dtstart}\nRRULE:${recurrenceRule}`, { forceset: false }) as RRule;
  } catch {
    return null;
  }
  if (recurrenceUntil && now >= recurrenceUntil) return null;
  const next = rule.after(now, true);
  if (!next) return null;
  if (recurrenceUntil && next > recurrenceUntil) return null;
  return next;
}

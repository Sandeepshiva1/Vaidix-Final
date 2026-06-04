-- ----------------------------------------------------------------------------
-- Allow overlapping host sessions (Teams-style: warn, don't block)
--
-- The original migration (20260413053844_scheduling_and_calendar) added a
-- btree_gist EXCLUDE constraint that hard-blocked any two APPROVED+SCHEDULED/LIVE
-- sessions for the same host from sharing time. Operationally that turned out
-- to be too strict: real schedules collide (a faculty member legitimately runs
-- back-to-back overlapping mentoring slots; a resident proposes a peer-led
-- session that overlaps a faculty grand-rounds they also plan to attend).
--
-- Teams, Google Calendar, and Outlook all permit overlapping events on the
-- same host's calendar and merely surface a "you have a conflict" warning.
-- We move conflict detection to the application layer (warning in the API
-- response, non-blocking in the UI) and drop the DB constraint here.
--
-- btree_gist extension is left installed — no other tables use EXCLUDE today
-- but a future feature might.
-- ----------------------------------------------------------------------------
ALTER TABLE "teaching_sessions"
  DROP CONSTRAINT IF EXISTS "teaching_sessions_host_time_no_overlap";

-- ════════════════════════════════════════════════════════════════════════════
-- W9.4 — Pre-session structured polls (extends LiveHook)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds a `pre_published_at` column to live_hooks so the presenter can publish
-- a poll BEFORE the live session starts, residents vote ahead of time, and
-- the same row continues to work in the existing in-session fire flow when
-- the presenter chooses to re-fire it live. Nullable, no backfill needed —
-- existing rows stay as drafts-or-fired, untouched.

ALTER TABLE "live_hooks"
  ADD COLUMN "prePublishedAt" TIMESTAMP(3);

-- Index supports the resident query "list pre-published polls for this
-- session" without scanning the whole table. The existing
-- (sessionId, firedAt) index keeps the live-session list-fired path fast.
CREATE INDEX "live_hooks_sessionId_prePublishedAt_idx"
  ON "live_hooks"("sessionId", "prePublishedAt");

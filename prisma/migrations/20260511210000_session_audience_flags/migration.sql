-- ============================================================================
-- Session Audience Flags — replace single-choice visibility enum with
-- orthogonal flags so a host can combine "anyone with link", "cohort", and
-- "specific invitees" in one session.
-- ============================================================================
-- Before: TeachingSession.visibility = OPEN_TO_ALL | COHORT | INVITE_ONLY | PRIVATE
-- After:  TeachingSession.openToAll  = Boolean (default false)
--         cohortId + invites[] continue to carry the cohort/invite scoping
--         (their presence is the signal — no enum gating).
--
-- Mapping during migration:
--   OPEN_TO_ALL → openToAll=true,  cohortId/invites untouched (none expected)
--   COHORT      → openToAll=false, cohortId already set
--   INVITE_ONLY → openToAll=false, invites already populated
--   PRIVATE     → openToAll=false, nothing else (host-only)

-- 1. Add the new column with a safe default.
ALTER TABLE "teaching_sessions"
    ADD COLUMN "openToAll" BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill from the legacy visibility column.
UPDATE "teaching_sessions" SET "openToAll" = true WHERE "visibility" = 'OPEN_TO_ALL';

-- 3. Drop the index on visibility before dropping the column.
DROP INDEX IF EXISTS "teaching_sessions_visibility_idx";

-- 4. Drop the column.
ALTER TABLE "teaching_sessions" DROP COLUMN "visibility";

-- 5. Drop the now-unused enum type.
DROP TYPE "SessionVisibility";

-- 6. Index the new boolean for the rare "list openToAll sessions" admin query.
CREATE INDEX "teaching_sessions_openToAll_idx" ON "teaching_sessions"("openToAll");

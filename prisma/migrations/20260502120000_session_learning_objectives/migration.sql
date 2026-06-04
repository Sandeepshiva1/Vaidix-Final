-- Structured learning objectives for TeachingSession + per-resident self-marks.
--
-- Why structured (not just free-text in description):
--   - Per-objective completion data feeds into Bloom's progress + EPA tracking
--     (currently we only know "attended", not "achieved which objective").
--   - Resident post-session checklist needs stable IDs to write marks against.
--
-- Why Json (not a 4th sub-table):
--   - Objectives are session-scoped, ordered, and rarely queried in bulk.
--     A separate table would force joins on every render for ~zero query
--     advantage. Object id is cuid generated at write-time.
--   - If we later need cross-session objective analytics (e.g. "how often is
--     'Identify subepithelial calcium' achieved?"), we promote to a table —
--     migration is forward-only since the Json carries the same shape.
--
-- ON DELETE CASCADE on achievements: a deleted session takes its marks with
-- it. user delete also cascades — same as study_pack_views (data is per-user
-- private, no audit trail required for the achievement itself).

-- 1. Objectives column (nullable Json — sessions without objectives behave as today).
ALTER TABLE "teaching_sessions"
  ADD COLUMN "objectives" JSONB;

-- 2. Achievement-status enum.
CREATE TYPE "ObjectiveAchievementStatus" AS ENUM ('YES', 'PARTLY', 'NO');

-- 3. Per-(session, user, objective) achievement marks.
CREATE TABLE "session_objective_achievements" (
  "id"          TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "status"      "ObjectiveAchievementStatus" NOT NULL,
  "note"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "session_objective_achievements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_objective_achievements_sessionId_userId_objectiveId_key"
  ON "session_objective_achievements"("sessionId", "userId", "objectiveId");

CREATE INDEX "session_objective_achievements_sessionId_objectiveId_idx"
  ON "session_objective_achievements"("sessionId", "objectiveId");

CREATE INDEX "session_objective_achievements_userId_idx"
  ON "session_objective_achievements"("userId");

ALTER TABLE "session_objective_achievements"
  ADD CONSTRAINT "session_objective_achievements_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_objective_achievements"
  ADD CONSTRAINT "session_objective_achievements_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

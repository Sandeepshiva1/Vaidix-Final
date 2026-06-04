-- Hierarchy + photo additions:
--   1) Invitation gains programDirectorId, facultyMentorId, cohortId, avatarUrl
--   2) User gains facultyMentorId (the resident's direct faculty mentor)
--
-- All columns nullable. Service layer enforces role compatibility:
--   - programDirectorId only meaningful when role=FACULTY
--   - facultyMentorId only meaningful when role=RESIDENT
--   - cohortId only meaningful when role=RESIDENT
-- DB only enforces existence (FK). ON DELETE SET NULL on every FK so removing
-- the referenced PD / mentor / cohort doesn't cascade-revoke pending invites
-- or detach the resident's record entirely.

-- ── User.facultyMentorId ────────────────────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN "facultyMentorId" TEXT;

CREATE INDEX "users_facultyMentorId_idx" ON "users"("facultyMentorId");

ALTER TABLE "users"
  ADD CONSTRAINT "users_facultyMentorId_fkey"
  FOREIGN KEY ("facultyMentorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── UserProfile.gender ──────────────────────────────────────────────────────
-- Free-form String (no enum) so future inclusivity values don't need migrations.
ALTER TABLE "user_profiles"
  ADD COLUMN "gender" TEXT;

-- ── Invitation new columns ─────────────────────────────────────────────────
ALTER TABLE "invitations"
  ADD COLUMN "programDirectorId" TEXT,
  ADD COLUMN "facultyMentorId"   TEXT,
  ADD COLUMN "cohortId"          TEXT,
  ADD COLUMN "avatarUrl"         TEXT,
  ADD COLUMN "gender"            TEXT;

CREATE INDEX "invitations_programDirectorId_idx" ON "invitations"("programDirectorId");
CREATE INDEX "invitations_facultyMentorId_idx"   ON "invitations"("facultyMentorId");
CREATE INDEX "invitations_cohortId_idx"          ON "invitations"("cohortId");

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_programDirectorId_fkey"
  FOREIGN KEY ("programDirectorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_facultyMentorId_fkey"
  FOREIGN KEY ("facultyMentorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

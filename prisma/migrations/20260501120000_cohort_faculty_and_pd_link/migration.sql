-- Cohort → Faculty mentor + Faculty → Program Director mappings.
--
-- Both columns are nullable. NO backfill: existing cohorts have no mentor and
-- existing faculty have no PD. Admin/PD wires the mappings via the cohort
-- drawer and the edit-user modal at their own pace.
--
-- ON DELETE SET NULL on both FKs: a faculty/PD departure (or soft-delete)
-- cleanly orphans the dependent rows without blocking the deletion. The
-- service layer additionally enforces role guards (cohort mentor must be
-- FACULTY, PD ref must be PROGRAM_DIRECTOR) — the DB only enforces existence.

-- 1. Cohort.facultyId — optional mentor link.
ALTER TABLE "cohorts"
  ADD COLUMN "facultyId" TEXT;

-- 2. User.programDirectorId — optional uplink for FACULTY users.
ALTER TABLE "users"
  ADD COLUMN "programDirectorId" TEXT;

-- 3. Indexes for the FK columns (lookup + reverse joins like "faculty under PD X").
CREATE INDEX "cohorts_facultyId_idx" ON "cohorts"("facultyId");
CREATE INDEX "users_programDirectorId_idx" ON "users"("programDirectorId");

-- 4. Foreign-key constraints with SET NULL on delete.
ALTER TABLE "cohorts"
  ADD CONSTRAINT "cohorts_facultyId_fkey"
  FOREIGN KEY ("facultyId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_programDirectorId_fkey"
  FOREIGN KEY ("programDirectorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

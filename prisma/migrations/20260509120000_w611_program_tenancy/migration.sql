-- W6.11 — Program multi-tenancy
--
-- Adds Program + ProgramMembership and scopes the 6 entry-point domain
-- tables (Cohort, TeachingSession, Topic, CaseTemplate, Pearl, Course) by
-- programId. Backfills every existing row into a default program so the
-- column lands NOT NULL in a single forward-only migration.
--
-- Why these 6 tables and not all ~94: every other domain table joins through
-- one of these via FK, inheriting scope transitively. e.g. Document is scoped
-- via DocumentSessionLink → TeachingSession.programId; EpaRecord is scoped
-- via the resident's ProgramMembership. Direct programId on the rest is a
-- follow-up audit (see VAIDIX-BUILD-PLAN-NOW.md W6.11 phase 2 notes).
--
-- Why slug uniqueness was relaxed (Topic, Course): a slug like
-- "empathy-basics" can legitimately exist in MS Ophth and Cornea Fellowship
-- without collision once the column is per-program. Existing rows backfill
-- into the default program where the prior global @unique still holds.

-- ─── 1. Enum ────────────────────────────────────────────────────────────────

CREATE TYPE "ProgramStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- ─── 2. programs ────────────────────────────────────────────────────────────

CREATE TABLE "programs" (
  "id"          TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "specialty"   TEXT,
  "institution" TEXT,
  "description" TEXT,
  "status"      "ProgramStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "programs_slug_key" ON "programs"("slug");
CREATE INDEX "programs_status_idx" ON "programs"("status");

-- ─── 3. program_memberships ────────────────────────────────────────────────

CREATE TABLE "program_memberships" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "role"      "Role",
  "addedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "addedBy"   TEXT,
  CONSTRAINT "program_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_memberships_userId_programId_key"
  ON "program_memberships"("userId", "programId");
CREATE INDEX "program_memberships_userId_idx"  ON "program_memberships"("userId");
CREATE INDEX "program_memberships_programId_idx" ON "program_memberships"("programId");

ALTER TABLE "program_memberships"
  ADD CONSTRAINT "program_memberships_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_memberships"
  ADD CONSTRAINT "program_memberships_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 4. Seed default program (LVPEI MS Ophthalmology) ──────────────────────
-- Generated with a known cuid-shape id so DDL backfill statements below can
-- reference it without a SELECT round-trip. The seed.ts script is idempotent
-- on slug, so re-seeding will not duplicate.

INSERT INTO "programs"
  ("id", "slug", "name", "specialty", "institution", "description", "status", "updatedAt")
VALUES (
  'prg_default_lvpei_ms',
  'lvpei-ms-ophthalmology',
  'LVPEI MS Ophthalmology',
  'Ophthalmology',
  'L V Prasad Eye Institute',
  'Default program — auto-created during W6.11 multi-tenancy migration. All pre-W6.11 data is scoped here.',
  'ACTIVE',
  CURRENT_TIMESTAMP
);

-- ─── 5. users.activeProgramId ──────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN "activeProgramId" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_activeProgramId_fkey"
  FOREIGN KEY ("activeProgramId") REFERENCES "programs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_activeProgramId_idx" ON "users"("activeProgramId");

-- Backfill: every existing user gets activeProgramId = default + a membership.
UPDATE "users" SET "activeProgramId" = 'prg_default_lvpei_ms' WHERE "deletedAt" IS NULL;

INSERT INTO "program_memberships" ("id", "userId", "programId", "role", "addedAt")
SELECT
  'pm_' || "id",
  "id",
  'prg_default_lvpei_ms',
  NULL,
  CURRENT_TIMESTAMP
FROM "users"
WHERE "deletedAt" IS NULL
ON CONFLICT ("userId", "programId") DO NOTHING;

-- ─── 6. Cohort.programId ───────────────────────────────────────────────────

ALTER TABLE "cohorts" ADD COLUMN "programId" TEXT;
UPDATE "cohorts" SET "programId" = 'prg_default_lvpei_ms';
ALTER TABLE "cohorts" ALTER COLUMN "programId" SET NOT NULL;

ALTER TABLE "cohorts"
  ADD CONSTRAINT "cohorts_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "cohorts_programId_idx" ON "cohorts"("programId");

-- ─── 7. TeachingSession.programId ──────────────────────────────────────────

ALTER TABLE "teaching_sessions" ADD COLUMN "programId" TEXT;
UPDATE "teaching_sessions" SET "programId" = 'prg_default_lvpei_ms';
ALTER TABLE "teaching_sessions" ALTER COLUMN "programId" SET NOT NULL;

ALTER TABLE "teaching_sessions"
  ADD CONSTRAINT "teaching_sessions_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "teaching_sessions_programId_idx" ON "teaching_sessions"("programId");

-- ─── 8. Topic.programId  + slug uniqueness change ──────────────────────────

ALTER TABLE "topics" ADD COLUMN "programId" TEXT;
UPDATE "topics" SET "programId" = 'prg_default_lvpei_ms';
ALTER TABLE "topics" ALTER COLUMN "programId" SET NOT NULL;

ALTER TABLE "topics"
  ADD CONSTRAINT "topics_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "topics_programId_idx" ON "topics"("programId");

-- Drop the global @unique on slug, replace with per-program unique
DROP INDEX "topics_slug_key";
CREATE UNIQUE INDEX "topics_programId_slug_key" ON "topics"("programId", "slug");

-- ─── 9. CaseTemplate.programId ─────────────────────────────────────────────

ALTER TABLE "case_templates" ADD COLUMN "programId" TEXT;
UPDATE "case_templates" SET "programId" = 'prg_default_lvpei_ms';
ALTER TABLE "case_templates" ALTER COLUMN "programId" SET NOT NULL;

ALTER TABLE "case_templates"
  ADD CONSTRAINT "case_templates_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "case_templates_programId_idx" ON "case_templates"("programId");

-- ─── 10. Pearl.programId ───────────────────────────────────────────────────

ALTER TABLE "pearls" ADD COLUMN "programId" TEXT;
UPDATE "pearls" SET "programId" = 'prg_default_lvpei_ms';
ALTER TABLE "pearls" ALTER COLUMN "programId" SET NOT NULL;

ALTER TABLE "pearls"
  ADD CONSTRAINT "pearls_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "pearls_programId_idx" ON "pearls"("programId");

-- ─── 11. Course.programId + slug uniqueness change ─────────────────────────

ALTER TABLE "courses" ADD COLUMN "programId" TEXT;
UPDATE "courses" SET "programId" = 'prg_default_lvpei_ms';
ALTER TABLE "courses" ALTER COLUMN "programId" SET NOT NULL;

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "courses_programId_idx" ON "courses"("programId");

DROP INDEX "courses_slug_key";
CREATE UNIQUE INDEX "courses_programId_slug_key" ON "courses"("programId", "slug");

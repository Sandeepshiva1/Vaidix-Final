-- ════════════════════════════════════════════════════════════════════════════
-- Phase 4 — case-forge: ownership, status, source linkage, AI artifacts
-- ════════════════════════════════════════════════════════════════════════════
-- Adds:
--   1. CaseTemplateStatus enum (DRAFT / PUBLISHED / ARCHIVED)
--   2. case_templates.ownerId           (FK -> users)
--   3. case_templates.status            (default PUBLISHED — keeps seeded
--                                        templates visible in resident bank)
--   4. case_templates.sourceDocumentId  (FK -> documents)
--   5. case_templates.stageGuidance     (Jsonb) — 5-stage AI mentor guidance
--   6. case_templates.analysisResult    (Jsonb) — router-v2 AI Coach payload
--   7. case_templates.forgedAt          (timestamp) — when AI generated it
--
-- Backfill strategy: existing rows get ownerId=NULL (legacy seeds had no
-- author concept) and status=PUBLISHED (default) so the resident library
-- continues to surface them.

-- 1. Enum
CREATE TYPE "CaseTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- 2-7. Columns
ALTER TABLE "case_templates"
  ADD COLUMN "ownerId"          TEXT,
  ADD COLUMN "status"           "CaseTemplateStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "sourceDocumentId" TEXT,
  ADD COLUMN "stageGuidance"    JSONB,
  ADD COLUMN "analysisResult"   JSONB,
  ADD COLUMN "forgedAt"         TIMESTAMP(3);

-- Foreign keys (SetNull on cascade — losing the user/document mustn't
-- cascade-delete the case templates that reference them)
ALTER TABLE "case_templates"
  ADD CONSTRAINT "case_templates_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "case_templates"
  ADD CONSTRAINT "case_templates_sourceDocumentId_fkey"
    FOREIGN KEY ("sourceDocumentId") REFERENCES "documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "case_templates_ownerId_idx"          ON "case_templates"("ownerId");
CREATE INDEX "case_templates_status_idx"           ON "case_templates"("status");
CREATE INDEX "case_templates_sourceDocumentId_idx" ON "case_templates"("sourceDocumentId");

-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1A — deck-forge wizard schema
-- ════════════════════════════════════════════════════════════════════════════
-- Non-destructive. Existing DeckForgeJob rows keep their `documentId` and
-- continue to work via the legacy "Forge presentation" quick-start. New
-- wizard jobs additionally populate the DeckForgeJobInput join table.

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "DeckForgeIntent" AS ENUM ('ENHANCE_EXISTING', 'DRAFT_FROM_SCRATCH');

CREATE TYPE "DeckForgeInputRole" AS ENUM ('PRIMARY_PPTX', 'SOURCE', 'PRIOR_TRANSCRIPT');

-- ─── DeckForgeJob: wizard fields ────────────────────────────────────────────

ALTER TABLE "deck_forge_jobs"
  ADD COLUMN "intent" "DeckForgeIntent",
  ADD COLUMN "briefing" JSONB;

-- ─── DeckForgeJobInput: multi-source join ───────────────────────────────────

CREATE TABLE "deck_forge_job_inputs" (
  "id"         TEXT NOT NULL,
  "jobId"      TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "role"       "DeckForgeInputRole" NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deck_forge_job_inputs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deck_forge_job_inputs_jobId_documentId_key"
  ON "deck_forge_job_inputs"("jobId", "documentId");

CREATE INDEX "deck_forge_job_inputs_jobId_idx"
  ON "deck_forge_job_inputs"("jobId");

CREATE INDEX "deck_forge_job_inputs_documentId_idx"
  ON "deck_forge_job_inputs"("documentId");

ALTER TABLE "deck_forge_job_inputs"
  ADD CONSTRAINT "deck_forge_job_inputs_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "deck_forge_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deck_forge_job_inputs"
  ADD CONSTRAINT "deck_forge_job_inputs_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

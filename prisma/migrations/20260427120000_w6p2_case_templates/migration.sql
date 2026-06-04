-- W6 Phase 2 — Case library templates (mock cases.json moves to DB)
-- Sequenced after 20260426120000_w6_pre_session_questions.

-- CreateEnum
CREATE TYPE "CaseDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- AlterTable: link a Case (resident attempt) back to its library template
ALTER TABLE "cases" ADD COLUMN "templateId" TEXT;
CREATE INDEX "cases_templateId_idx" ON "cases"("templateId");

-- CreateTable
CREATE TABLE "case_templates" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "title" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "topicId" TEXT,
    "bloomsLevel" INTEGER NOT NULL DEFAULT 3,
    "difficulty" "CaseDifficulty" NOT NULL DEFAULT 'INTERMEDIATE',
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 20,
    "description" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientAgeYears" INTEGER NOT NULL,
    "patientSex" TEXT NOT NULL,
    "patientPresentingComplaint" TEXT NOT NULL,
    "oslerianPrinciples" TEXT[],
    "tags" TEXT[],
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_templates_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "case_templates_legacyId_key" ON "case_templates"("legacyId");
CREATE INDEX "case_templates_specialty_idx" ON "case_templates"("specialty");
CREATE INDEX "case_templates_difficulty_idx" ON "case_templates"("difficulty");
CREATE INDEX "case_templates_topicId_idx" ON "case_templates"("topicId");

-- Foreign keys
ALTER TABLE "cases" ADD CONSTRAINT "cases_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "case_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "case_templates" ADD CONSTRAINT "case_templates_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

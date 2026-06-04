-- W6.8 — Pre-Conference Polish (Study Pack + Pre-Cases + Teaser Video)
--
-- Purely additive migration:
--   * 1 new value on DocumentRoute    (PROMO_TEASER_VIDEO)
--   * 4 new values on EngagementSignalKind (PRE_READING_VIEWED, PRE_VIDEO_WATCHED,
--                                           PRE_CASE_STARTED, PRE_CASE_COMPLETED)
--   * 2 new columns on document_session_links (both with safe defaults)
--   * 2 new tables: session_pre_cases, study_pack_views
--   * Indexes + FKs (cascade matches the existing per-session convention)
--
-- No DROP, no ALTER TYPE that requires data backfill, no destructive ops.

-- AlterEnum
ALTER TYPE "DocumentRoute" ADD VALUE 'PROMO_TEASER_VIDEO';

-- AlterEnum (additive only — Postgres 12+ accepts multiple ADD VALUEs when run autocommit)
ALTER TYPE "EngagementSignalKind" ADD VALUE 'PRE_READING_VIEWED';
ALTER TYPE "EngagementSignalKind" ADD VALUE 'PRE_VIDEO_WATCHED';
ALTER TYPE "EngagementSignalKind" ADD VALUE 'PRE_CASE_STARTED';
ALTER TYPE "EngagementSignalKind" ADD VALUE 'PRE_CASE_COMPLETED';

-- AlterTable
ALTER TABLE "document_session_links" ADD COLUMN     "isPreSession" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preSessionRank" INTEGER;

-- CreateTable
CREATE TABLE "session_pre_cases" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "caseTemplateId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pre_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_pack_views" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentLinkId" TEXT,
    "preCaseId" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSec" INTEGER,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "study_pack_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_pre_cases_sessionId_rank_idx" ON "session_pre_cases"("sessionId", "rank");

-- CreateIndex
CREATE INDEX "session_pre_cases_caseTemplateId_idx" ON "session_pre_cases"("caseTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "session_pre_cases_sessionId_caseTemplateId_key" ON "session_pre_cases"("sessionId", "caseTemplateId");

-- CreateIndex
CREATE INDEX "study_pack_views_sessionId_userId_idx" ON "study_pack_views"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "study_pack_views_userId_viewedAt_idx" ON "study_pack_views"("userId", "viewedAt");

-- CreateIndex
CREATE INDEX "study_pack_views_sessionId_documentLinkId_idx" ON "study_pack_views"("sessionId", "documentLinkId");

-- CreateIndex
CREATE INDEX "study_pack_views_sessionId_preCaseId_idx" ON "study_pack_views"("sessionId", "preCaseId");

-- CreateIndex
CREATE INDEX "document_session_links_sessionId_isPreSession_idx" ON "document_session_links"("sessionId", "isPreSession");

-- AddForeignKey
ALTER TABLE "session_pre_cases" ADD CONSTRAINT "session_pre_cases_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_pre_cases" ADD CONSTRAINT "session_pre_cases_caseTemplateId_fkey" FOREIGN KEY ("caseTemplateId") REFERENCES "case_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_pre_cases" ADD CONSTRAINT "session_pre_cases_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_pack_views" ADD CONSTRAINT "study_pack_views_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_pack_views" ADD CONSTRAINT "study_pack_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_pack_views" ADD CONSTRAINT "study_pack_views_documentLinkId_fkey" FOREIGN KEY ("documentLinkId") REFERENCES "document_session_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_pack_views" ADD CONSTRAINT "study_pack_views_preCaseId_fkey" FOREIGN KEY ("preCaseId") REFERENCES "session_pre_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

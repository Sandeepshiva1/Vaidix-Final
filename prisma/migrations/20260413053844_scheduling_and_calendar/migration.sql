/*
  Warnings:

  - Added the required column `proposedBy` to the `teaching_sessions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SessionApprovalStatus" AS ENUM ('DRAFT', 'PENDING_FACULTY', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionVisibility" AS ENUM ('OPEN_TO_ALL', 'COHORT', 'INVITE_ONLY', 'PRIVATE');

-- CreateEnum
CREATE TYPE "SessionInviteStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionApprovalAction" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'CANCELLED', 'RESCHEDULED', 'AUTO_APPROVED');

-- AlterTable
ALTER TABLE "teaching_sessions" ADD COLUMN     "approvalStatus" "SessionApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "cohortId" TEXT,
ADD COLUMN     "parentSessionId" TEXT,
ADD COLUMN     "proposedBy" TEXT NOT NULL,
ADD COLUMN     "recurrenceRule" TEXT,
ADD COLUMN     "recurrenceUntil" TIMESTAMP(3),
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "visibility" "SessionVisibility" NOT NULL DEFAULT 'OPEN_TO_ALL';

-- CreateTable
CREATE TABLE "cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "academicYear" TEXT,
    "status" "CohortStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort_members" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_invites" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SessionInviteStatus" NOT NULL DEFAULT 'INVITED',
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "session_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_approval_audits" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "SessionApprovalAction" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_approval_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cohorts_status_idx" ON "cohorts"("status");

-- CreateIndex
CREATE INDEX "cohorts_createdBy_idx" ON "cohorts"("createdBy");

-- CreateIndex
CREATE INDEX "cohort_members_cohortId_idx" ON "cohort_members"("cohortId");

-- CreateIndex
CREATE INDEX "cohort_members_userId_idx" ON "cohort_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cohort_members_cohortId_userId_key" ON "cohort_members"("cohortId", "userId");

-- CreateIndex
CREATE INDEX "session_invites_sessionId_idx" ON "session_invites"("sessionId");

-- CreateIndex
CREATE INDEX "session_invites_userId_status_idx" ON "session_invites"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "session_invites_sessionId_userId_key" ON "session_invites"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "session_approval_audits_sessionId_createdAt_idx" ON "session_approval_audits"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "session_approval_audits_actorId_idx" ON "session_approval_audits"("actorId");

-- CreateIndex
CREATE INDEX "teaching_sessions_proposedBy_idx" ON "teaching_sessions"("proposedBy");

-- CreateIndex
CREATE INDEX "teaching_sessions_approvalStatus_idx" ON "teaching_sessions"("approvalStatus");

-- CreateIndex
CREATE INDEX "teaching_sessions_visibility_idx" ON "teaching_sessions"("visibility");

-- CreateIndex
CREATE INDEX "teaching_sessions_cohortId_idx" ON "teaching_sessions"("cohortId");

-- CreateIndex
CREATE INDEX "teaching_sessions_scheduledEnd_idx" ON "teaching_sessions"("scheduledEnd");

-- CreateIndex
CREATE INDEX "teaching_sessions_parentSessionId_idx" ON "teaching_sessions"("parentSessionId");

-- AddForeignKey
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_proposedBy_fkey" FOREIGN KEY ("proposedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "teaching_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_approval_audits" ADD CONSTRAINT "session_approval_audits_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_approval_audits" ADD CONSTRAINT "session_approval_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- Host conflict prevention (race-free, DB-enforced)
-- btree_gist combines text equality with tsrange overlap (&&).
-- Only applies to APPROVED/LIVE sessions so drafts/rejects don't block new drafts.
-- Uses tsrange (not tstzrange) because Prisma DateTime maps to timestamp(3)
-- without time zone; tstzrange() would require a non-IMMUTABLE cast.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "teaching_sessions"
  ADD CONSTRAINT "teaching_sessions_host_time_no_overlap"
  EXCLUDE USING GIST (
    "hostId" WITH =,
    tsrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  )
  WHERE ("approvalStatus" = 'APPROVED' AND "status" IN ('SCHEDULED', 'LIVE') AND "deletedAt" IS NULL);

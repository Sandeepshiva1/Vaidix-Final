-- W5 — Breakouts + Q&A reply threads + Recording share links
-- Owners: W5 stream (qa-sidebar, breakouts-panel, breakout-room-view, recording-share)
-- Sequenced after 20260424130000_w4_sprint_engagement_hooks_kirkpatrick.

-- CreateEnum
CREATE TYPE "BreakoutGroupingMode" AS ENUM ('RANDOM', 'SELF_SELECT', 'AI_AUTO');

-- CreateEnum
CREATE TYPE "BreakoutStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "BreakoutAgentLogKind" AS ENUM ('SUMMARY', 'PROBE_QUESTION', 'SILENCE_NUDGE', 'UNANSWERED_QUESTION', 'INTERVENTION');

-- AlterTable: QaItem self-FK for single-level reply threads
ALTER TABLE "qa_items" ADD COLUMN "parentId" TEXT;
ALTER TABLE "qa_items" ADD CONSTRAINT "qa_items_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "qa_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "qa_items_parentId_idx" ON "qa_items"("parentId");

-- CreateTable
CREATE TABLE "breakouts" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupingMode" "BreakoutGroupingMode" NOT NULL,
    "livekitRoomName" TEXT NOT NULL,
    "status" "BreakoutStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breakouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breakout_participants" (
    "id" TEXT NOT NULL,
    "breakoutId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "breakout_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breakout_agent_logs" (
    "id" TEXT NOT NULL,
    "breakoutId" TEXT NOT NULL,
    "kind" "BreakoutAgentLogKind" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "breakout_agent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_shares" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recording_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_share_accesses" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "failReason" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_share_accesses_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "breakouts_livekitRoomName_key" ON "breakouts"("livekitRoomName");
CREATE INDEX "breakouts_sessionId_idx" ON "breakouts"("sessionId");
CREATE INDEX "breakouts_status_idx" ON "breakouts"("status");

CREATE UNIQUE INDEX "breakout_participants_breakoutId_userId_key" ON "breakout_participants"("breakoutId", "userId");
CREATE INDEX "breakout_participants_userId_idx" ON "breakout_participants"("userId");

CREATE INDEX "breakout_agent_logs_breakoutId_createdAt_idx" ON "breakout_agent_logs"("breakoutId", "createdAt");

CREATE UNIQUE INDEX "recording_shares_token_key" ON "recording_shares"("token");
CREATE INDEX "recording_shares_recordingId_idx" ON "recording_shares"("recordingId");
CREATE INDEX "recording_shares_expiresAt_idx" ON "recording_shares"("expiresAt");

CREATE INDEX "recording_share_accesses_shareId_accessedAt_idx" ON "recording_share_accesses"("shareId", "accessedAt");

-- Foreign Keys
ALTER TABLE "breakouts" ADD CONSTRAINT "breakouts_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "breakouts" ADD CONSTRAINT "breakouts_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "breakout_participants" ADD CONSTRAINT "breakout_participants_breakoutId_fkey"
  FOREIGN KEY ("breakoutId") REFERENCES "breakouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "breakout_participants" ADD CONSTRAINT "breakout_participants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "breakout_agent_logs" ADD CONSTRAINT "breakout_agent_logs_breakoutId_fkey"
  FOREIGN KEY ("breakoutId") REFERENCES "breakouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recording_shares" ADD CONSTRAINT "recording_shares_recordingId_fkey"
  FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recording_shares" ADD CONSTRAINT "recording_shares_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recording_shares" ADD CONSTRAINT "recording_shares_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recording_share_accesses" ADD CONSTRAINT "recording_share_accesses_shareId_fkey"
  FOREIGN KEY ("shareId") REFERENCES "recording_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

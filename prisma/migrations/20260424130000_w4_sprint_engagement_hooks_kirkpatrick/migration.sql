-- CreateEnum
CREATE TYPE "ClipKind" AS ENUM ('REGULAR', 'REEL');

-- CreateEnum
CREATE TYPE "KirkpatrickLevel" AS ENUM ('L1_REACTION', 'L2_LEARNING', 'L3_BEHAVIOR', 'L4_RESULTS');

-- CreateEnum
CREATE TYPE "EngagementSignalKind" AS ENUM ('ATTENTION_DROP', 'INTERACTION_SILENCE', 'HOOK_RESPONSE', 'PARTICIPATION', 'CHAT_MESSAGE', 'HAND_RAISE', 'POLL_VOTE', 'CAMERA_ON', 'CAMERA_OFF');

-- CreateEnum
CREATE TYPE "LiveHookKind" AS ENUM ('TRUE_FALSE', 'POLL', 'ONE_WORD', 'REPEAT_CONCEPT', 'DILEMMA');

-- CreateEnum
CREATE TYPE "PresenterAlertKind" AS ENUM ('ENGAGEMENT_LOW', 'ATTENTION_DROPPING', 'ASK_QUESTION', 'TOO_MUCH_LECTURE', 'TIME_REMAINING');

-- CreateEnum
CREATE TYPE "PresenterAlertSeverity" AS ENUM ('INFO', 'WARN', 'HIGH');

-- AlterEnum
ALTER TYPE "DocumentRoute" ADD VALUE 'PROMO_ASSET';

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "clips" ADD COLUMN     "kind" "ClipKind" NOT NULL DEFAULT 'REGULAR';

-- AlterTable
ALTER TABLE "deck_forge_jobs" ADD COLUMN     "analysisResult" JSONB;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "promptType" TEXT,
ADD COLUMN     "prompted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "engagement_signals" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "EngagementSignalKind" NOT NULL,
    "value" DECIMAL(6,3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_hooks" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "LiveHookKind" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "correctOption" TEXT,
    "explanation" TEXT,
    "intervalSeconds" INTEGER,
    "scheduledAt" TIMESTAMP(3),
    "firedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_hook_responses" (
    "id" TEXT NOT NULL,
    "hookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_hook_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presenter_alerts" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "presenterId" TEXT NOT NULL,
    "kind" "PresenterAlertKind" NOT NULL,
    "severity" "PresenterAlertSeverity" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presenter_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kirkpatrick_evaluations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "KirkpatrickLevel" NOT NULL,
    "sessionId" TEXT,
    "score" DECIMAL(5,2) NOT NULL,
    "surveyData" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kirkpatrick_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kirkpatrick_evidence" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "weight" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kirkpatrick_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "engagement_signals_sessionId_createdAt_idx" ON "engagement_signals"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "engagement_signals_sessionId_userId_kind_idx" ON "engagement_signals"("sessionId", "userId", "kind");

-- CreateIndex
CREATE INDEX "engagement_signals_userId_createdAt_idx" ON "engagement_signals"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "live_hooks_sessionId_scheduledAt_idx" ON "live_hooks"("sessionId", "scheduledAt");

-- CreateIndex
CREATE INDEX "live_hooks_sessionId_firedAt_idx" ON "live_hooks"("sessionId", "firedAt");

-- CreateIndex
CREATE INDEX "live_hook_responses_userId_idx" ON "live_hook_responses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "live_hook_responses_hookId_userId_key" ON "live_hook_responses"("hookId", "userId");

-- CreateIndex
CREATE INDEX "presenter_alerts_sessionId_createdAt_idx" ON "presenter_alerts"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "presenter_alerts_presenterId_acknowledgedAt_idx" ON "presenter_alerts"("presenterId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "kirkpatrick_evaluations_userId_level_idx" ON "kirkpatrick_evaluations"("userId", "level");

-- CreateIndex
CREATE INDEX "kirkpatrick_evaluations_sessionId_idx" ON "kirkpatrick_evaluations"("sessionId");

-- CreateIndex
CREATE INDEX "kirkpatrick_evidence_evaluationId_idx" ON "kirkpatrick_evidence"("evaluationId");

-- CreateIndex
CREATE INDEX "kirkpatrick_evidence_evidenceType_evidenceId_idx" ON "kirkpatrick_evidence"("evidenceType", "evidenceId");

-- CreateIndex
CREATE INDEX "clips_kind_idx" ON "clips"("kind");

-- CreateIndex
CREATE INDEX "journal_entries_prompted_idx" ON "journal_entries"("prompted");

-- AddForeignKey
ALTER TABLE "engagement_signals" ADD CONSTRAINT "engagement_signals_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_signals" ADD CONSTRAINT "engagement_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_hooks" ADD CONSTRAINT "live_hooks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_hook_responses" ADD CONSTRAINT "live_hook_responses_hookId_fkey" FOREIGN KEY ("hookId") REFERENCES "live_hooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_hook_responses" ADD CONSTRAINT "live_hook_responses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presenter_alerts" ADD CONSTRAINT "presenter_alerts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presenter_alerts" ADD CONSTRAINT "presenter_alerts_presenterId_fkey" FOREIGN KEY ("presenterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kirkpatrick_evaluations" ADD CONSTRAINT "kirkpatrick_evaluations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kirkpatrick_evaluations" ADD CONSTRAINT "kirkpatrick_evaluations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kirkpatrick_evidence" ADD CONSTRAINT "kirkpatrick_evidence_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "kirkpatrick_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterEnum: Stream D #9 WhatsApp consent
ALTER TYPE "ConsentType" ADD VALUE 'WHATSAPP_NOTIFICATIONS';

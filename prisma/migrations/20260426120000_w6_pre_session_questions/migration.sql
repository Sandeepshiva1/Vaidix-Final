-- W6 — Pre-Conference Question Submission Engine (Feeddback #2)
-- Sequenced after 20260425120000_w5_breakouts_qa_threads_recording_share.

-- CreateEnum
CREATE TYPE "PreSessionQuestionUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "pre_session_questions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "urgency" "PreSessionQuestionUrgency" NOT NULL DEFAULT 'NORMAL',
    "themeId" TEXT,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_session_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_session_question_votes" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_session_question_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_session_question_themes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_session_question_themes_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "pre_session_questions_sessionId_voteCount_idx" ON "pre_session_questions"("sessionId", "voteCount");
CREATE INDEX "pre_session_questions_sessionId_createdAt_idx" ON "pre_session_questions"("sessionId", "createdAt");
CREATE INDEX "pre_session_questions_userId_idx" ON "pre_session_questions"("userId");
CREATE INDEX "pre_session_questions_themeId_idx" ON "pre_session_questions"("themeId");

CREATE UNIQUE INDEX "pre_session_question_votes_questionId_userId_key" ON "pre_session_question_votes"("questionId", "userId");
CREATE INDEX "pre_session_question_votes_userId_idx" ON "pre_session_question_votes"("userId");

CREATE INDEX "pre_session_question_themes_sessionId_rank_idx" ON "pre_session_question_themes"("sessionId", "rank");

-- Foreign keys
ALTER TABLE "pre_session_questions" ADD CONSTRAINT "pre_session_questions_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pre_session_questions" ADD CONSTRAINT "pre_session_questions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pre_session_questions" ADD CONSTRAINT "pre_session_questions_themeId_fkey"
  FOREIGN KEY ("themeId") REFERENCES "pre_session_question_themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pre_session_question_votes" ADD CONSTRAINT "pre_session_question_votes_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "pre_session_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pre_session_question_votes" ADD CONSTRAINT "pre_session_question_votes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pre_session_question_themes" ADD CONSTRAINT "pre_session_question_themes_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

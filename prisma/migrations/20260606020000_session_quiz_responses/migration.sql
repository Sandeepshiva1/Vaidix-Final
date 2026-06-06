-- CreateTable
CREATE TABLE "session_quiz_responses" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" INTEGER NOT NULL,
    "answerText" TEXT,
    "isCorrect" BOOLEAN,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_quiz_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_quiz_responses_sessionId_idx" ON "session_quiz_responses"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "session_quiz_responses_sessionId_userId_questionId_key" ON "session_quiz_responses"("sessionId", "userId", "questionId");

-- AddForeignKey
ALTER TABLE "session_quiz_responses" ADD CONSTRAINT "session_quiz_responses_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_quiz_responses" ADD CONSTRAINT "session_quiz_responses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

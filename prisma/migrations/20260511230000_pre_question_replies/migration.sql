-- Pre-Conference Q&A reply threads (single-level)
-- Mirrors the QaItem self-FK pattern from w5_breakouts_qa_threads_recording_share.
-- App-level guard in pre-questions-service rejects nested replies; the FK
-- cascade on parent delete keeps the orphan replies cleaned up.

-- AlterTable
ALTER TABLE "pre_session_questions" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "pre_session_questions_parentId_idx" ON "pre_session_questions"("parentId");

-- AddForeignKey
ALTER TABLE "pre_session_questions" ADD CONSTRAINT "pre_session_questions_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "pre_session_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

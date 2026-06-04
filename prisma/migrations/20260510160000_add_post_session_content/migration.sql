-- W8.3 Post-Session Content Pack
-- Adds PostSessionQa, SjtCase, PblScenario tables and extends pearls with sourceSessionTranscriptId.

-- Pearl: nullable FK to the live transcript that produced this pearl
ALTER TABLE "pearls" ADD COLUMN IF NOT EXISTS "sourceSessionTranscriptId" TEXT;
CREATE INDEX IF NOT EXISTS "pearls_sourceSessionTranscriptId_idx" ON "pearls"("sourceSessionTranscriptId");

-- AI-extracted Q&A pairs from live session transcript
CREATE TABLE IF NOT EXISTS "post_session_qa" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "sessionTranscriptId" TEXT NOT NULL,
  "question"            TEXT NOT NULL,
  "answer"              TEXT NOT NULL,
  "source"              TEXT NOT NULL DEFAULT 'claude',
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_session_qa_sessionTranscriptId_fkey"
    FOREIGN KEY ("sessionTranscriptId")
    REFERENCES "session_transcripts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "post_session_qa_sessionTranscriptId_idx" ON "post_session_qa"("sessionTranscriptId");

-- AI-generated SJT cases from live session transcript
CREATE TABLE IF NOT EXISTS "sjt_cases" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "sessionTranscriptId" TEXT NOT NULL,
  "stem"                TEXT NOT NULL,
  "options"             JSONB NOT NULL DEFAULT '[]',
  "correctIndex"        INTEGER,
  "rationale"           TEXT NOT NULL,
  "createdByAi"         BOOLEAN NOT NULL DEFAULT true,
  "approved"            BOOLEAN NOT NULL DEFAULT false,
  "approvedById"        TEXT,
  "approvedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sjt_cases_sessionTranscriptId_fkey"
    FOREIGN KEY ("sessionTranscriptId")
    REFERENCES "session_transcripts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "sjt_cases_sessionTranscriptId_idx" ON "sjt_cases"("sessionTranscriptId");

-- AI-generated PBL scenarios from live session transcript
CREATE TABLE IF NOT EXISTS "pbl_scenarios" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "sessionTranscriptId" TEXT NOT NULL,
  "trigger"             TEXT NOT NULL,
  "objectives"          JSONB NOT NULL DEFAULT '[]',
  "content"             TEXT NOT NULL,
  "createdByAi"         BOOLEAN NOT NULL DEFAULT true,
  "approved"            BOOLEAN NOT NULL DEFAULT false,
  "approvedById"        TEXT,
  "approvedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pbl_scenarios_sessionTranscriptId_fkey"
    FOREIGN KEY ("sessionTranscriptId")
    REFERENCES "session_transcripts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pbl_scenarios_sessionTranscriptId_idx" ON "pbl_scenarios"("sessionTranscriptId");

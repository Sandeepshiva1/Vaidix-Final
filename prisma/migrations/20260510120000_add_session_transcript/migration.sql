-- ────────────────────────────────────────────────────────────────────────────
-- Live captions persistence — sessionId-keyed, distinct from `transcripts`
-- (which is recordingId-keyed and populated by the post-recording batch
-- transcribe-worker). Captions producer (Deepgram in Phase 1; Sarvam in
-- Phase 2) appends finalized segments here as they arrive over the live
-- session WebSocket, so post-session export and Gemini summary work even
-- when the session was not recorded (recordingEnabled=false).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE "session_transcripts" (
  "id"          TEXT         NOT NULL,
  "sessionId"   TEXT         NOT NULL,
  "language"    TEXT         NOT NULL,
  "source"      TEXT         NOT NULL DEFAULT 'deepgram',
  "segments"    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "contentText" TEXT         NOT NULL DEFAULT '',
  "finalized"   BOOLEAN      NOT NULL DEFAULT false,
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" TIMESTAMP(3),
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "session_transcripts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_transcripts_sessionId_language_key"
  ON "session_transcripts" ("sessionId", "language");

CREATE INDEX "session_transcripts_sessionId_idx"
  ON "session_transcripts" ("sessionId");

ALTER TABLE "session_transcripts"
  ADD CONSTRAINT "session_transcripts_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

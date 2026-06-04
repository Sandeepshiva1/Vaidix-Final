-- ════════════════════════════════════════════════════════════════════════════
-- W7 Live-conference parity — surgical schema patch
-- ════════════════════════════════════════════════════════════════════════════
-- Applied via `prisma db execute` (or psql) instead of `prisma migrate dev`
-- because the migration history has pre-existing W6.11 divergence on
-- unrelated tables (programId additions). This script is idempotent: every
-- statement uses IF NOT EXISTS / IF EXISTS guards so re-running is a no-op.

-- ─── 1. SessionAuditEvent.tMs (replay-time offset) ─────────────────────────────
ALTER TABLE "session_audit_events"
  ADD COLUMN IF NOT EXISTS "tMs" INTEGER;

CREATE INDEX IF NOT EXISTS "session_audit_events_sessionId_eventType_createdAt_idx"
  ON "session_audit_events" ("sessionId", "eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "session_audit_events_sessionId_tMs_idx"
  ON "session_audit_events" ("sessionId", "tMs");

-- ─── 2. TeachingSession.isWebinar ─────────────────────────────────────────────
ALTER TABLE "teaching_sessions"
  ADD COLUMN IF NOT EXISTS "isWebinar" BOOLEAN NOT NULL DEFAULT false;

-- ─── 3. Recording.startedAtRoom ───────────────────────────────────────────────
ALTER TABLE "recordings"
  ADD COLUMN IF NOT EXISTS "startedAtRoom" TIMESTAMP(3);

-- ─── 4. session_files ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session_files" (
  "id"           TEXT PRIMARY KEY,
  "sessionId"    TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "s3Key"        TEXT NOT NULL UNIQUE,
  "sha256"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_files_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE,
  CONSTRAINT "session_files_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "session_files_sessionId_createdAt_idx"
  ON "session_files" ("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "session_files_uploadedById_idx"
  ON "session_files" ("uploadedById");

-- ─── 5. session_chat_messages.attachmentId ────────────────────────────────────
ALTER TABLE "session_chat_messages"
  ADD COLUMN IF NOT EXISTS "attachmentId" TEXT UNIQUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_chat_messages_attachmentId_fkey'
  ) THEN
    ALTER TABLE "session_chat_messages"
      ADD CONSTRAINT "session_chat_messages_attachmentId_fkey"
      FOREIGN KEY ("attachmentId") REFERENCES "session_files"("id") ON DELETE SET NULL;
  END IF;
END$$;

-- ─── 6. shared_notes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shared_notes" (
  "id"                  TEXT PRIMARY KEY,
  "sessionId"           TEXT NOT NULL UNIQUE,
  "content"             TEXT NOT NULL,
  "version"             INTEGER NOT NULL DEFAULT 0,
  "editableByResidents" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shared_notes_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE
);

-- ─── 7. shared_note_edits ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shared_note_edits" (
  "id"        TEXT PRIMARY KEY,
  "noteId"    TEXT NOT NULL,
  "authorId"  TEXT NOT NULL,
  "version"   INTEGER NOT NULL,
  "delta"     JSONB NOT NULL,
  "snapshot"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shared_note_edits_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "shared_notes"("id") ON DELETE CASCADE,
  CONSTRAINT "shared_note_edits_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "shared_note_edits_noteId_version_key" UNIQUE ("noteId", "version")
);
CREATE INDEX IF NOT EXISTS "shared_note_edits_noteId_createdAt_idx"
  ON "shared_note_edits" ("noteId", "createdAt");

-- ─── 8. webinar_registrations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "webinar_registrations" (
  "id"           TEXT PRIMARY KEY,
  "sessionId"    TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "organisation" TEXT,
  "roleTitle"    TEXT,
  "confirmToken" TEXT NOT NULL UNIQUE,
  "confirmedAt"  TIMESTAMP(3),
  "userId"       TEXT,
  "source"       TEXT,
  "consented"    BOOLEAN NOT NULL DEFAULT false,
  "attendedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webinar_registrations_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE,
  CONSTRAINT "webinar_registrations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "webinar_registrations_sessionId_email_key" UNIQUE ("sessionId", "email")
);
CREATE INDEX IF NOT EXISTS "webinar_registrations_sessionId_confirmedAt_idx"
  ON "webinar_registrations" ("sessionId", "confirmedAt");
CREATE INDEX IF NOT EXISTS "webinar_registrations_email_idx"
  ON "webinar_registrations" ("email");

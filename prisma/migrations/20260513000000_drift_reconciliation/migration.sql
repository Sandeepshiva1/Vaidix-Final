-- ============================================================================
-- Drift Reconciliation — capture schema objects that were pushed to the dev
-- DB without an accompanying migration file. Generated via:
--   prisma migrate diff --from-migrations ./prisma/migrations \
--     --to-url $DATABASE_URL --shadow-database-url ...
-- Then hand-edited:
--   * Blueprint column DROPs removed (they are added by the NEXT migration,
--     20260512100000_blueprint_audience_fields — not drift).
--   * "public." schema prefix stripped to match house style.
--   * IF NOT EXISTS / IF EXISTS guards added so the file is safe to replay
--     against any DB that may already have the objects.
--   * ADD CONSTRAINT wrapped in DO blocks (Postgres has no IF NOT EXISTS for
--     constraints).
--
-- On the live dev DB this migration is marked applied via
--   prisma migrate resolve --applied 20260513000000_drift_reconciliation
-- because every object below already exists there. The SQL is kept on disk
-- so a fresh replay (CI / new dev machine) reproduces the same end state.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FacultyEditSignalKind') THEN
    CREATE TYPE "FacultyEditSignalKind" AS ENUM ('REFINE_INSTRUCTION', 'SLIDE_EDIT', 'SUGGESTION_ACCEPTED', 'SUGGESTION_DISMISSED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FacultyStyleProfileStatus') THEN
    CREATE TYPE "FacultyStyleProfileStatus" AS ENUM ('EMPTY', 'ACTIVE', 'USER_DISABLED');
  END IF;
END $$;

-- DropForeignKey (replaced below with corrected ON DELETE behavior)
ALTER TABLE "deck_forge_jobs" DROP CONSTRAINT IF EXISTS "deck_forge_jobs_documentId_fkey";

-- AlterTable — drop legacy defaults that were applied via db push
ALTER TABLE "pbl_scenarios" ALTER COLUMN "objectives" DROP DEFAULT;
ALTER TABLE "sjt_cases"     ALTER COLUMN "options"    DROP DEFAULT;
ALTER TABLE "slides"        ALTER COLUMN "bullets"    DROP DEFAULT;

-- AlterTable — add columns added via db push
ALTER TABLE "recordings"            ADD COLUMN IF NOT EXISTS "startedAtRoom" TIMESTAMP(3);
ALTER TABLE "session_audit_events"  ADD COLUMN IF NOT EXISTS "tMs" INTEGER;
ALTER TABLE "session_chat_messages" ADD COLUMN IF NOT EXISTS "attachmentId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "faculty_edit_signals" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "kind" "FacultyEditSignalKind" NOT NULL,
    "topicTag" TEXT,
    "audienceTag" TEXT,
    "sessionType" TEXT,
    "jobId" TEXT,
    "slideId" TEXT,
    "instructionText" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "faculty_edit_signals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "faculty_style_profiles" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "status" "FacultyStyleProfileStatus" NOT NULL DEFAULT 'EMPTY',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "promptContext" TEXT,
    "signalCountAtBuild" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastBuildAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "faculty_style_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_files" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "sha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_note_edits" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "delta" JSONB NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shared_note_edits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_notes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "editableByResidents" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shared_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "webinar_registrations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organisation" TEXT,
    "roleTitle" TEXT,
    "confirmToken" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "userId" TEXT,
    "source" TEXT,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "attendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webinar_registrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "whiteboard_snapshots" (
    "id" TEXT NOT NULL,
    "whiteboardId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "tMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whiteboard_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "whiteboards" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "editableByResidents" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whiteboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "faculty_edit_signals_facultyId_createdAt_idx"   ON "faculty_edit_signals"("facultyId", "createdAt");
CREATE INDEX IF NOT EXISTS "faculty_edit_signals_facultyId_processedAt_idx" ON "faculty_edit_signals"("facultyId", "processedAt");
CREATE INDEX IF NOT EXISTS "faculty_edit_signals_facultyId_topicTag_idx"    ON "faculty_edit_signals"("facultyId", "topicTag");
CREATE UNIQUE INDEX IF NOT EXISTS "faculty_style_profiles_facultyId_key"    ON "faculty_style_profiles"("facultyId");
CREATE UNIQUE INDEX IF NOT EXISTS "session_files_s3Key_key"                 ON "session_files"("s3Key");
CREATE INDEX IF NOT EXISTS "session_files_sessionId_createdAt_idx"          ON "session_files"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "session_files_uploadedById_idx"                 ON "session_files"("uploadedById");
CREATE INDEX IF NOT EXISTS "shared_note_edits_noteId_createdAt_idx"         ON "shared_note_edits"("noteId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "shared_note_edits_noteId_version_key"    ON "shared_note_edits"("noteId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "shared_notes_sessionId_key"              ON "shared_notes"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "webinar_registrations_confirmToken_key"  ON "webinar_registrations"("confirmToken");
CREATE INDEX IF NOT EXISTS "webinar_registrations_email_idx"                ON "webinar_registrations"("email");
CREATE INDEX IF NOT EXISTS "webinar_registrations_sessionId_confirmedAt_idx" ON "webinar_registrations"("sessionId", "confirmedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "webinar_registrations_sessionId_email_key" ON "webinar_registrations"("sessionId", "email");
CREATE INDEX IF NOT EXISTS "whiteboard_snapshots_whiteboardId_createdAt_idx" ON "whiteboard_snapshots"("whiteboardId", "createdAt");
CREATE INDEX IF NOT EXISTS "whiteboard_snapshots_whiteboardId_tMs_idx"      ON "whiteboard_snapshots"("whiteboardId", "tMs");
CREATE UNIQUE INDEX IF NOT EXISTS "whiteboards_sessionId_key"               ON "whiteboards"("sessionId");
CREATE INDEX IF NOT EXISTS "session_audit_events_sessionId_eventType_createdAt_idx" ON "session_audit_events"("sessionId", "eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "session_audit_events_sessionId_tMs_idx"         ON "session_audit_events"("sessionId", "tMs");
CREATE UNIQUE INDEX IF NOT EXISTS "session_chat_messages_attachmentId_key"  ON "session_chat_messages"("attachmentId");

-- AddForeignKey (idempotent via pg_constraint existence checks)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deck_forge_jobs_documentId_fkey') THEN
    ALTER TABLE "deck_forge_jobs" ADD CONSTRAINT "deck_forge_jobs_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'faculty_edit_signals_facultyId_fkey') THEN
    ALTER TABLE "faculty_edit_signals" ADD CONSTRAINT "faculty_edit_signals_facultyId_fkey"
      FOREIGN KEY ("facultyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'faculty_style_profiles_facultyId_fkey') THEN
    ALTER TABLE "faculty_style_profiles" ADD CONSTRAINT "faculty_style_profiles_facultyId_fkey"
      FOREIGN KEY ("facultyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_chat_messages_attachmentId_fkey') THEN
    ALTER TABLE "session_chat_messages" ADD CONSTRAINT "session_chat_messages_attachmentId_fkey"
      FOREIGN KEY ("attachmentId") REFERENCES "session_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_files_sessionId_fkey') THEN
    ALTER TABLE "session_files" ADD CONSTRAINT "session_files_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_files_uploadedById_fkey') THEN
    ALTER TABLE "session_files" ADD CONSTRAINT "session_files_uploadedById_fkey"
      FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_note_edits_authorId_fkey') THEN
    ALTER TABLE "shared_note_edits" ADD CONSTRAINT "shared_note_edits_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_note_edits_noteId_fkey') THEN
    ALTER TABLE "shared_note_edits" ADD CONSTRAINT "shared_note_edits_noteId_fkey"
      FOREIGN KEY ("noteId") REFERENCES "shared_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_notes_sessionId_fkey') THEN
    ALTER TABLE "shared_notes" ADD CONSTRAINT "shared_notes_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webinar_registrations_sessionId_fkey') THEN
    ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webinar_registrations_userId_fkey') THEN
    ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whiteboard_snapshots_authorId_fkey') THEN
    ALTER TABLE "whiteboard_snapshots" ADD CONSTRAINT "whiteboard_snapshots_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whiteboard_snapshots_whiteboardId_fkey') THEN
    ALTER TABLE "whiteboard_snapshots" ADD CONSTRAINT "whiteboard_snapshots_whiteboardId_fkey"
      FOREIGN KEY ("whiteboardId") REFERENCES "whiteboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whiteboards_sessionId_fkey') THEN
    ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- W7 Phase 2 — Whiteboard
-- ════════════════════════════════════════════════════════════════════════════
-- Idempotent. Re-running this is safe.

-- ─── 1. whiteboards ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "whiteboards" (
  "id"                   TEXT PRIMARY KEY,
  "sessionId"            TEXT NOT NULL UNIQUE,
  "editableByResidents"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whiteboards_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE
);

-- ─── 2. whiteboard_snapshots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "whiteboard_snapshots" (
  "id"            TEXT PRIMARY KEY,
  "whiteboardId"  TEXT NOT NULL,
  "authorId"      TEXT NOT NULL,
  "snapshot"      JSONB NOT NULL,
  "tMs"           INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whiteboard_snapshots_whiteboardId_fkey"
    FOREIGN KEY ("whiteboardId") REFERENCES "whiteboards"("id") ON DELETE CASCADE,
  CONSTRAINT "whiteboard_snapshots_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "whiteboard_snapshots_whiteboardId_createdAt_idx"
  ON "whiteboard_snapshots" ("whiteboardId", "createdAt");
CREATE INDEX IF NOT EXISTS "whiteboard_snapshots_whiteboardId_tMs_idx"
  ON "whiteboard_snapshots" ("whiteboardId", "tMs");

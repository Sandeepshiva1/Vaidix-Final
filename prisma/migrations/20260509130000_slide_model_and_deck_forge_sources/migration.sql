-- Slide model + DeckForgeJob multi-source support
-- Allows DeckForgeJob to be sourced from a Document, a Recording transcript,
-- or both, and introduces Slide rows as the canonical deck representation.

-- ── DeckForgeJob: add new enums + columns ─────────────────────────────────

CREATE TYPE "DeckForgeSource" AS ENUM ('DOCUMENT', 'TRANSCRIPT', 'HYBRID');

CREATE TYPE "SlideLayout" AS ENUM (
  'TITLE_ONLY',
  'TITLE_BULLETS',
  'TWO_COLUMN',
  'IMAGE_FOCUS',
  'QUOTE',
  'INTERACTION',
  'CLOSING'
);

-- documentId becomes nullable (transcript-only forges have none)
ALTER TABLE "deck_forge_jobs" ALTER COLUMN "documentId" DROP NOT NULL;

-- New optional recording source + source-kind discriminator
ALTER TABLE "deck_forge_jobs" ADD COLUMN "recordingId" TEXT;
ALTER TABLE "deck_forge_jobs" ADD COLUMN "sourceKind" "DeckForgeSource" NOT NULL DEFAULT 'DOCUMENT';

ALTER TABLE "deck_forge_jobs"
  ADD CONSTRAINT "deck_forge_jobs_recordingId_fkey"
  FOREIGN KEY ("recordingId") REFERENCES "recordings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "deck_forge_jobs_recordingId_idx" ON "deck_forge_jobs"("recordingId");
CREATE INDEX "deck_forge_jobs_requestedById_idx" ON "deck_forge_jobs"("requestedById");

-- ── Slide table ───────────────────────────────────────────────────────────

CREATE TABLE "slides" (
  "id"              TEXT NOT NULL,
  "deckForgeJobId"  TEXT NOT NULL,
  "order"           INTEGER NOT NULL,
  "layout"          "SlideLayout" NOT NULL DEFAULT 'TITLE_BULLETS',
  "title"           TEXT NOT NULL,
  "bullets"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "speakerNotes"    TEXT,
  "sourceCitations" JSONB,
  "accentHex"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "slides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slides_deckForgeJobId_order_key" ON "slides"("deckForgeJobId", "order");
CREATE INDEX "slides_deckForgeJobId_idx" ON "slides"("deckForgeJobId");

ALTER TABLE "slides"
  ADD CONSTRAINT "slides_deckForgeJobId_fkey"
  FOREIGN KEY ("deckForgeJobId") REFERENCES "deck_forge_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

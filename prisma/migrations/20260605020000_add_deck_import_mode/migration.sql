-- ============================================================================
-- Faithful import: DeckForgeJob.importMode + Slide.sourceImageS3Key
-- ============================================================================
-- Supports showing an uploaded slide deck (PPTX, or a PDF the classifier judged
-- to be slides) "as is": a 1:1 editable copy PLUS a pixel-faithful rasterised
-- preview of each original slide. AI generation stays the path for prose
-- sources (text PDFs, DOCX, notes, typed topic).
--
--   importMode        — VERBATIM (imported deck) vs AI_GENERATED (authored).
--                       Defaults AI_GENERATED so every existing/legacy job
--                       keeps its current behaviour.
--   sourceImageS3Key  — PNG of the original slide backing a Slide row, for the
--                       editor's "Original" view. Null on AI-generated decks.
--
-- Enum create guarded with a DO/EXCEPTION block (Postgres lacks CREATE TYPE IF
-- NOT EXISTS); column adds use IF NOT EXISTS — matches the project's
-- replay-safe house style.

DO $$ BEGIN
  CREATE TYPE "DeckImportMode" AS ENUM ('AI_GENERATED', 'VERBATIM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "deck_forge_jobs"
  ADD COLUMN IF NOT EXISTS "importMode" "DeckImportMode" NOT NULL DEFAULT 'AI_GENERATED';

ALTER TABLE "slides"
  ADD COLUMN IF NOT EXISTS "sourceImageS3Key" TEXT;

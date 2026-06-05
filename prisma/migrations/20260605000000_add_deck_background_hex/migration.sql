-- ============================================================================
-- DeckForgeJob: add backgroundHex for a per-deck background colour override
-- ============================================================================
-- Faculty asked for a way to set the slide background independently of the
-- chosen theme (e.g. force pure black). `backgroundHex` stores a 6-char hex
-- string with NO leading '#'. Null = fall back to the theme's default bg.
-- Honoured by both the web SlideCanvas and the .pptx export renderer.
--
-- Nullable + IF NOT EXISTS guard matches the project's house style (see
-- 20260516000000_slide_images/migration.sql) so the migration is safe to
-- replay against a DB that may already have the column from a prior
-- `prisma db push`.

ALTER TABLE "deck_forge_jobs"
  ADD COLUMN IF NOT EXISTS "backgroundHex" TEXT;

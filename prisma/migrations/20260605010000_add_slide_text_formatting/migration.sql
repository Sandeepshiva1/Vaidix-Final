-- ============================================================================
-- Slide: add text-formatting + table fields edited from the studio ribbon
-- ============================================================================
-- The PowerPoint-style editor ribbon now actually persists what it shows:
--   * bold / italic / underline — slide-level text emphasis (title + body)
--   * fontScale                 — multiplies the computed title/body font size
--                                 (1 = theme default; UI + API clamp 0.6–1.6)
--   * tableJson                 — optional inserted table { rows: string[][] }
--
-- Honoured by both the web SlideCanvas and the .pptx export renderer.
--
-- Nullable/defaulted + IF NOT EXISTS guard matches the project's house style
-- (see 20260605000000_add_deck_background_hex/migration.sql) so the migration
-- is safe to replay against a DB that may already have the columns from a
-- prior `prisma db push`.

ALTER TABLE "slides"
  ADD COLUMN IF NOT EXISTS "bold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "italic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "underline" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fontScale" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "tableJson" JSONB;

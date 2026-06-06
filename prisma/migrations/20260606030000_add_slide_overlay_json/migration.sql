-- ============================================================================
-- Slide: add overlayJson — faithful-import editable text overlay
-- ============================================================================
-- VERBATIM PPTX imports that carry per-shape geometry persist an editable
-- overlay of positioned text boxes laid over the rasterised original slide, so
-- faculty can edit the deck in place without losing the original look. Shape:
--   { boxes: Array<{ slotId; text; x; y; w; h (0..1);
--       fillHex?; colorHex?; fontPct?; bold?; italic?;
--       align?:'l'|'ctr'|'r'|'just'; valign?:'t'|'ctr'|'b' }> }
-- Null for AI-generated slides and verbatim imports without geometry.
--
-- DRIFT FIX: the `overlayJson` field shipped in prisma/schema.prisma (Slide
-- model) without an accompanying migration — it was likely applied locally via
-- `prisma db push`. Production therefore generated a Prisma Client that SELECTs
-- and INSERTs `slides.overlayJson`, but `migrate deploy` never created the
-- column, so deck upload in preconference failed with P2022
-- ("column slides.overlayJson does not exist"). `migrate status` reported
-- "up to date" because it only diffs migration files against _prisma_migrations
-- and cannot see a schema field that no migration covers.
--
-- Nullable + IF NOT EXISTS guard matches the project's house style
-- (see 20260605010000_add_slide_text_formatting/migration.sql) so it is safe to
-- replay against a DB that already has the column from a prior `db push` or a
-- manual hotfix ALTER.

ALTER TABLE "slides"
  ADD COLUMN IF NOT EXISTS "overlayJson" JSONB;

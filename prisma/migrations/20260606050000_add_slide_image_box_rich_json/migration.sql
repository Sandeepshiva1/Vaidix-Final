-- ============================================================================
-- Slide: add imageBox + richJson — free image placement + inline rich text
-- ============================================================================
--   * imageBox — PowerPoint-style free placement/size for the slide image,
--                fractions of the slide (0..1): { x, y, w, h }. Null = use the
--                layout-derived default box (resolveImageBox). Honoured by the
--                web SlideCanvas and the .pptx export.
--   * richJson — inline rich-text runs for title/bullets (per-selection
--                bold/italic/underline). Shape:
--                { title?: string(html), bullets?: (string|null)[] } where each
--                value is sanitised HTML limited to <b>/<i>/<u>/<strong>/<em>.
--                Plain-text mirrors in title/bullets stay authoritative.
--
-- DRIFT FIX (same class as 20260606030000_add_slide_overlay_json): both fields
-- shipped in prisma/schema.prisma without an accompanying migration — applied
-- locally via `prisma db push`. Without this, production would generate a Prisma
-- Client that SELECTs/INSERTs slides.imageBox / slides.richJson while
-- migrate deploy never created the columns, failing with P2022.
--
-- Nullable + IF NOT EXISTS guard matches the project's house style so it is safe
-- to replay against a DB that already has the columns from a prior db push.

ALTER TABLE "slides"
  ADD COLUMN IF NOT EXISTS "imageBox" JSONB,
  ADD COLUMN IF NOT EXISTS "richJson" JSONB;

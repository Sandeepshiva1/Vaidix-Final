-- ============================================================================
-- Slide: add imageS3Key + imagePrompt for wizard-forge generated images
-- ============================================================================
-- Schema change rationale: the wizard-forge pipeline now invokes the existing
-- aiGenerateImageForSlide router (Gemini 2.5 Flash Image) for IMAGE_FOCUS
-- slides after the Opus draft step. The resulting PNG is uploaded to S3 at
-- `documents/deck-forge/<userId>/<jobId>/slide-<order>.png` and its key is
-- stored on the Slide row so the .pptx renderer can paint it into the deck
-- (replacing the previous dashed-rectangle placeholder).
--
-- imagePrompt is kept alongside for audit and so the Studio can regenerate
-- with faculty edits to the prompt without re-running the prompt-writing
-- step.
--
-- Both columns are nullable: a missing image (generation skipped or failed)
-- never blocks the deck — the renderer falls back to the placeholder.
--
-- IF NOT EXISTS guards match the project's house style (see
-- 20260514000000_session_admission_guest_support/migration.sql) so the
-- migration is safe to replay against any DB that may already have the
-- columns from a prior `prisma db push`.

ALTER TABLE "slides"
  ADD COLUMN IF NOT EXISTS "imageS3Key" TEXT;

ALTER TABLE "slides"
  ADD COLUMN IF NOT EXISTS "imagePrompt" TEXT;

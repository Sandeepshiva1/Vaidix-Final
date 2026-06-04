-- W9 follow-up — store the raw promo-share token so the prep panel can
-- recover and display an existing share after page reload. Promo content is
-- public marketing material (not PHI), so the same hash-only threat model
-- recording-share uses is overkill here.

ALTER TABLE "promo_shares"
  ADD COLUMN "token" TEXT;

-- Existing rows (created during the W9 dev cycle before this column landed)
-- have no recoverable raw token. Stamp a placeholder so the NOT NULL +
-- UNIQUE constraints land cleanly; those rows can't be reopened by URL but
-- they're still useful for analytics / access counts.
UPDATE "promo_shares"
   SET "token" = CONCAT('legacy_', id)
 WHERE "token" IS NULL;

ALTER TABLE "promo_shares"
  ALTER COLUMN "token" SET NOT NULL;

CREATE UNIQUE INDEX "promo_shares_token_key" ON "promo_shares"("token");

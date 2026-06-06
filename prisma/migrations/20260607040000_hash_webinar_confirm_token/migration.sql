-- Migration: replace plaintext confirmToken with confirmTokenHash (SHA-256)
-- Any unconfirmed registrations created before this migration will be
-- invalidated. Affected registrants will need to re-register. This is
-- acceptable: these are short-lived email confirmation tokens and the
-- change is a security fix. Confirmed registrations are unaffected.

-- Step 1: add the hash column as nullable
ALTER TABLE "WebinarRegistration" ADD COLUMN "confirmTokenHash" TEXT;

-- Step 2: invalidate existing unconfirmed rows by setting a sentinel value
-- that will never match a real SHA-256 hash. Confirmed rows (confirmedAt IS
-- NOT NULL) are kept with a static sentinel since the token is no longer needed.
UPDATE "WebinarRegistration"
SET "confirmTokenHash" = 'invalidated:' || gen_random_uuid()::text
WHERE "confirmedAt" IS NULL;

UPDATE "WebinarRegistration"
SET "confirmTokenHash" = 'confirmed:' || gen_random_uuid()::text
WHERE "confirmedAt" IS NOT NULL;

-- Step 3: make the column required and add unique index
ALTER TABLE "WebinarRegistration" ALTER COLUMN "confirmTokenHash" SET NOT NULL;
CREATE UNIQUE INDEX "WebinarRegistration_confirmTokenHash_key"
    ON "WebinarRegistration"("confirmTokenHash");

-- Step 4: drop the old plaintext column and its unique index
DROP INDEX IF EXISTS "WebinarRegistration_confirmToken_key";
ALTER TABLE "WebinarRegistration" DROP COLUMN "confirmToken";

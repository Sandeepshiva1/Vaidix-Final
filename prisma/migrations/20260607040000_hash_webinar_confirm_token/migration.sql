-- Migration: replace plaintext confirmToken with confirmTokenHash (SHA-256)
-- Any unconfirmed registrations created before this migration will be
-- invalidated. Affected registrants will need to re-register. This is
-- acceptable: these are short-lived email confirmation tokens and the
-- change is a security fix. Confirmed registrations are unaffected.

-- Step 1: add the hash column as nullable
ALTER TABLE "webinar_registrations" ADD COLUMN "confirmTokenHash" TEXT;

-- Step 2: invalidate existing unconfirmed rows by setting a sentinel value
-- that will never match a real SHA-256 hash. Confirmed rows (confirmedAt IS
-- NOT NULL) are kept with a static sentinel since the token is no longer needed.
UPDATE "webinar_registrations"
SET "confirmTokenHash" = 'invalidated:' || gen_random_uuid()::text
WHERE "confirmedAt" IS NULL;

UPDATE "webinar_registrations"
SET "confirmTokenHash" = 'confirmed:' || gen_random_uuid()::text
WHERE "confirmedAt" IS NOT NULL;

-- Step 3: make the column required and add unique index
ALTER TABLE "webinar_registrations" ALTER COLUMN "confirmTokenHash" SET NOT NULL;
CREATE UNIQUE INDEX "webinar_registrations_confirmTokenHash_key"
    ON "webinar_registrations"("confirmTokenHash");

-- Step 4: drop the old plaintext column and its unique index
DROP INDEX IF EXISTS "webinar_registrations_confirmToken_key";
ALTER TABLE "webinar_registrations" DROP COLUMN "confirmToken";

-- HARDENING-PLAN.md item #12 — hash recording-share tokens at rest.
-- Adds tokenHash (sha256 of the raw token), backfills from existing rows,
-- destroys the plaintext at rest, and drops the legacy unique index.
--
-- The legacy `token` column is left in place (now nullable) so a rolling
-- deploy doesn't crash on Prisma client mismatch. A follow-up migration drops
-- the column once production has been on the new client for one release.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "recording_shares" ADD COLUMN "tokenHash" TEXT;

UPDATE "recording_shares"
   SET "tokenHash" = encode(digest("token", 'sha256'), 'hex')
 WHERE "tokenHash" IS NULL;

ALTER TABLE "recording_shares" ALTER COLUMN "tokenHash" SET NOT NULL;

CREATE UNIQUE INDEX "recording_shares_tokenHash_key" ON "recording_shares"("tokenHash");

-- Destroy plaintext at rest. New rows never write to this column.
UPDATE "recording_shares" SET "token" = NULL;

DROP INDEX IF EXISTS "recording_shares_token_key";
ALTER TABLE "recording_shares" ALTER COLUMN "token" DROP NOT NULL;

-- Multi-identifier login: add User.mobile + User.username (both unique).
--
-- Backfill plan:
--   1. Mobile is copied from the user's most recent ACCEPTED invitation
--      where invitation.mobile is set. Mobile is canonicalised to '+91XXXXXXXXXX'.
--      Duplicates abort the migration — operator resolves via `dpdpa_requests`
--      or by fixing invitation rows.
--   2. Username is auto-generated from email local-part with a numeric suffix
--      on collision. Operator can override later via /admin/users.

-- 1. Add columns (nullable; UNIQUE applies via index below).
ALTER TABLE "users"
  ADD COLUMN "mobile"   TEXT,
  ADD COLUMN "username" TEXT;

-- 2. Backfill mobile from latest accepted invitation, canonical form.
WITH latest_accepted AS (
  SELECT
    i."email",
    i."mobile",
    ROW_NUMBER() OVER (PARTITION BY i."email" ORDER BY i."acceptedAt" DESC NULLS LAST) AS rn
  FROM "invitations" i
  WHERE i."status" = 'ACCEPTED' AND i."mobile" IS NOT NULL
)
UPDATE "users" u
   SET "mobile" = (
     CASE
       -- '+91XXXXXXXXXX' canonical
       WHEN la."mobile" ~ '^\+91[6-9][0-9]{9}$' THEN la."mobile"
       -- '91XXXXXXXXXX' → '+91XXXXXXXXXX'
       WHEN la."mobile" ~ '^91[6-9][0-9]{9}$' THEN '+' || la."mobile"
       -- '0XXXXXXXXXX' → '+91XXXXXXXXXX'
       WHEN la."mobile" ~ '^0[6-9][0-9]{9}$' THEN '+91' || substring(la."mobile" FROM 2)
       -- 'XXXXXXXXXX' (10 digits starting 6-9) → '+91XXXXXXXXXX'
       WHEN la."mobile" ~ '^[6-9][0-9]{9}$' THEN '+91' || la."mobile"
       ELSE NULL
     END
   )
  FROM latest_accepted la
 WHERE la."email" = u."email" AND la.rn = 1;

-- 3. Drop unparseable mobile values (set to NULL) so the UNIQUE index doesn't
--    collide on garbage. The migration MUST keep mobile UNIQUE on success.
DO $$
DECLARE
  dupes int;
BEGIN
  -- Detect duplicates *before* enforcing UNIQUE. If any, the operator must
  -- resolve them via /admin/users.
  SELECT count(*) INTO dupes FROM (
    SELECT "mobile" FROM "users" WHERE "mobile" IS NOT NULL
    GROUP BY "mobile" HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'Mobile-number backfill produced % duplicate value(s). Resolve invitations.mobile and re-run.', dupes;
  END IF;
END
$$;

-- 4. Auto-generate username from email local-part with collision suffix.
--    'a.b+tag@host' -> 'a.b'; lowercased; non-[a-z0-9_-] stripped to '_';
--    truncated to 32 chars; suffix '-2', '-3', ... on collision.
WITH base AS (
  SELECT
    "id",
    LEFT(
      regexp_replace(
        lower(split_part("email", '@', 1)),
        '[^a-z0-9_-]+', '_', 'g'
      ),
      28
    ) AS proto
  FROM "users"
),
candidates AS (
  SELECT
    "id",
    proto,
    ROW_NUMBER() OVER (PARTITION BY proto ORDER BY "id") AS rn
  FROM base
  WHERE proto <> ''
)
UPDATE "users" u
   SET "username" = CASE
     WHEN c.rn = 1 THEN c.proto
     ELSE c.proto || '-' || c.rn::text
   END
  FROM candidates c
 WHERE c."id" = u."id";

-- 5. Fallback: any user with empty proto (e.g. weird email like 'a@b.c' where
--    local part normalises to empty) gets 'user-<8 chars of id>' so they're
--    still loginable by username.
UPDATE "users"
   SET "username" = 'user-' || lower(substring("id" FROM 1 FOR 8))
 WHERE "username" IS NULL OR "username" = '';

-- 6. Truncate to 32 chars defensively.
UPDATE "users" SET "username" = LEFT("username", 32);

-- 7. Final UNIQUE indexes.
CREATE UNIQUE INDEX "users_mobile_key"   ON "users"("mobile");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- Operator note (RUNBOOK-DEPLOY.md):
-- After this migration the runtime app can authenticate by email, mobile, or
-- username. The credentials provider accepts an `identifier` field that
-- detects format. `email` keeps working as a back-compat alias.

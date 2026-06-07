-- Reconcile residual drift left over from earlier `db push` usage so the
-- database matches schema.prisma exactly (migrate dev will now report no diff).
--
-- 1. `@updatedAt` columns are managed app-side by Prisma and must NOT carry a
--    DB-level default. These three still had one from a prior db push.
ALTER TABLE "session_shares"  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "specialties"     ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "sub_specialties" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 2. `user_preferences.medlearnEnabled` was added by an orphan migration that
--    exists only in SOME databases' history (a dev DB from a prior `db push`),
--    not in any migration file. The current schema no longer declares it. Drop
--    it to converge. `IF EXISTS` makes this safe on environments (e.g. prod)
--    that never had the orphan column — without it this errored with 42703 and
--    blocked every subsequent migration. Destructive but the column is unused.
ALTER TABLE "user_preferences" DROP COLUMN IF EXISTS "medlearnEnabled";

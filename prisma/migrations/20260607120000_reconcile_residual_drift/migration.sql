-- Reconcile residual drift left over from earlier `db push` usage so the
-- database matches schema.prisma exactly (migrate dev will now report no diff).
--
-- 1. `@updatedAt` columns are managed app-side by Prisma and must NOT carry a
--    DB-level default. These three still had one from a prior db push.
ALTER TABLE "session_shares"  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "specialties"     ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "sub_specialties" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 2. `user_preferences.medlearnEnabled` was added by an orphan migration that
--    exists only in the DB history (not in any migration file). The current
--    schema no longer declares it. Drop it to converge. Destructive but the
--    column is unused by the current codebase.
ALTER TABLE "user_preferences" DROP COLUMN "medlearnEnabled";

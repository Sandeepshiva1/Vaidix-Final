-- ============================================================================
-- SessionAdmission: support anonymous guest joiners alongside registered users
-- ============================================================================
-- Schema change rationale: SessionAdmission now serves two flavours of joiner:
--   (a) Registered Vaidix user joining a session they're not a member of
--       via share link → row has userId set, guestKey null.
--   (b) Anonymous guest joining an `openToAll = true` session without
--       signing in (Teams-style) → row has guestKey set (random opaque
--       token also stored in an HttpOnly cookie), userId null.
--
-- Host/co-host admits or denies either flavour through the same routes.
-- See [model SessionAdmission] in prisma/schema.prisma for the full doc.
--
-- IF EXISTS / IF NOT EXISTS guards match the project's house style (see
-- 20260513000000_drift_reconciliation/migration.sql) so the migration is
-- safe to replay against any DB that may already have the objects from a
-- prior db push.

-- Allow userId to be null (previously NOT NULL) so guest rows can omit it.
ALTER TABLE "session_admissions"
  ALTER COLUMN "userId" DROP NOT NULL;

-- New nullable column for the guest's opaque token. NULL for registered
-- users; populated with a random token for guests.
ALTER TABLE "session_admissions"
  ADD COLUMN IF NOT EXISTS "guestKey" TEXT;

-- Partial-style uniqueness: at most one row per (sessionId, guestKey) when
-- guestKey is set. Postgres treats NULL as distinct, so multiple registered-
-- user rows (guestKey=NULL) coexist without conflict. The existing
-- (sessionId, userId) unique index keeps the same semantics for the
-- registered-user side.
CREATE UNIQUE INDEX IF NOT EXISTS "session_admissions_sessionId_guestKey_key"
  ON "session_admissions"("sessionId", "guestKey");

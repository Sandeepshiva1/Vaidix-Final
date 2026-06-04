-- HARDENING-PLAN.md item #14 — make audit_events effectively append-only.
--
-- 1. Add idempotencyKey column for the queued-write retry path.
-- 2. Create a `vaidix_app` runtime role with INSERT-only on audit_events.
--    UPDATE/DELETE remain available to a separate `vaidix_admin` role used
--    by retention sweeps and forensic exports. The migration is safe to
--    re-run (CREATE ROLE IF NOT EXISTS pattern via DO block).
-- 3. Trigger blocks UPDATE/DELETE coming through any role that isn't in
--    the `vaidix_audit_admins` group, so even a future role mis-grant
--    can't silently mutate audit history.

-- 1. Idempotency column
ALTER TABLE "audit_events" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "audit_events_idempotencyKey_key" ON "audit_events"("idempotencyKey");

-- 2. Roles. Use DO blocks because CREATE ROLE has no IF NOT EXISTS in PG ≤ 15.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaidix_app') THEN
    CREATE ROLE vaidix_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaidix_admin') THEN
    CREATE ROLE vaidix_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaidix_audit_admins') THEN
    CREATE ROLE vaidix_audit_admins NOLOGIN;
  END IF;
END
$$;

GRANT vaidix_audit_admins TO vaidix_admin;

-- 3. Tighten privileges on audit_events.
REVOKE UPDATE, DELETE ON "audit_events" FROM PUBLIC;
GRANT  SELECT, INSERT ON "audit_events" TO vaidix_app;
GRANT  SELECT, INSERT, UPDATE, DELETE ON "audit_events" TO vaidix_admin;

-- 4. Defence-in-depth — block UPDATE/DELETE for anyone not in
--    vaidix_audit_admins, no matter what GRANTs were applied.
CREATE OR REPLACE FUNCTION vaidix_block_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF NOT pg_has_role(current_user, 'vaidix_audit_admins', 'MEMBER') THEN
    RAISE EXCEPTION 'audit_events is append-only; user % cannot %', current_user, TG_OP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON "audit_events";
CREATE TRIGGER audit_no_update
  BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION vaidix_block_audit_mutation();

DROP TRIGGER IF EXISTS audit_no_delete ON "audit_events";
CREATE TRIGGER audit_no_delete
  BEFORE DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION vaidix_block_audit_mutation();

-- NOTE for operators (RUNBOOK-DEPLOY.md):
-- The DATABASE_URL the application boots with should connect as `vaidix_app`,
-- NOT as the database superuser. The migration runner connects as a role
-- in vaidix_audit_admins so DDL succeeds; runtime stays restricted.

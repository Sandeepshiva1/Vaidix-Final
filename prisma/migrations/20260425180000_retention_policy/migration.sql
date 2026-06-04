-- HARDENING-PLAN.md item #16 — extend the existing retention_policies table
-- with operator-facing columns + seed default rows.
--
-- The base table already exists from the initial schema migration.

ALTER TABLE "retention_policies"
  ADD COLUMN IF NOT EXISTS "strategy"     TEXT NOT NULL DEFAULT 'purge',
  ADD COLUMN IF NOT EXISTS "lastSweepAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "description"  TEXT;

-- Seed default policies. ON CONFLICT keeps existing operator-tweaked rows.
INSERT INTO "retention_policies"
  ("id", "entityType", "retentionDays", "strategy", "description", "active", "updatedAt")
VALUES
  ('rp-recording',           'RECORDING',                365, 'purge',     'HLS playlists + segments',                      true, CURRENT_TIMESTAMP),
  ('rp-transcript',          'TRANSCRIPT',               365, 'purge',     'VTT files + diarisation',                       true, CURRENT_TIMESTAMP),
  ('rp-case-conv',           'CASE_CONVERSATION',         90, 'anonymise', 'Resident <-> mentor case dialogue',             true, CURRENT_TIMESTAMP),
  ('rp-engagement',          'ENGAGEMENT_SIGNAL',         90, 'purge',     'Hand raise / question fired etc.',              true, CURRENT_TIMESTAMP),
  ('rp-dlq-job',             'DLQ_JOB',                   30, 'purge',     'Dead-letter queue jobs (HARDENING-PLAN #8)',    true, CURRENT_TIMESTAMP),
  ('rp-share-access',        'RECORDING_SHARE_ACCESS',   180, 'purge',     'Per-access log on recording_share_accesses',    true, CURRENT_TIMESTAMP),
  ('rp-recording-share',     'RECORDING_SHARE',           90, 'purge',     'Expired share-link rows (token already hashed)',true, CURRENT_TIMESTAMP),
  ('rp-audit',               'AUDIT_EVENT',          7 * 365, 'purge',     'Regulatory minimum 7y; protected by triggers',  false, CURRENT_TIMESTAMP),
  ('rp-presigned-audit',     'PRESIGNED_URL_AUDIT',       30, 'purge',     'Presigned-URL access audit',                    true, CURRENT_TIMESTAMP)
ON CONFLICT ("entityType") DO NOTHING;

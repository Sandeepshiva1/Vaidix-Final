#!/usr/bin/env bash
# HARDENING-PLAN item #6 — set up streaming replication on first init.
# Runs once when postgres-primary starts on a fresh data dir.
set -e

PGUSER="${POSTGRES_PRIMARY_USER:-vaidix_admin}"
REPL_PASS="${POSTGRES_REPLICATOR_PASSWORD:-change_me_replicator}"

psql -v ON_ERROR_STOP=1 --username "$PGUSER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '$REPL_PASS';
  SELECT pg_create_physical_replication_slot('replica1');
SQL

# Allow the replica to connect.
{
  echo "host replication replicator 0.0.0.0/0 scram-sha-256"
  echo "host all all 0.0.0.0/0 scram-sha-256"
} >> "$PGDATA/pg_hba.conf"

# Reload — the entrypoint will pick this up on its first startup.

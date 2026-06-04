#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Vaidix — smoke-all.sh  (umbrella smoke runner)
# ════════════════════════════════════════════════════════════════════════════
# Runs every local smoke suite in sequence. CI calls this single script
# instead of each smoke individually. Exit 0 = all pass; non-zero = one or
# more failed (failures are collected and reported at the end so you see all
# failures in one run, not just the first).
#
# Usage (from repo root):
#   ./scripts/smoke-all.sh
#
# Prerequisites:
#   - bash + envsubst (gettext-base)
#   - tsx in PATH  (npx tsx works if tsx not global)
#   - .env with ANTHROPIC_API_KEY + GEMINI_API_KEY for the AI smoke
#     (wizard-forge smoke auto-skips the LLM phase if keys are absent)
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0

run_smoke() {
  local label="$1"
  shift
  printf "\n══════════════════════════════════════════════════\n"
  printf "  %s\n" "$label"
  printf "══════════════════════════════════════════════════\n"
  if "$@"; then
    PASS=$((PASS + 1))
    printf "\n[smoke-all] ✓  %s passed\n" "$label"
  else
    FAIL=$((FAIL + 1))
    printf "\n[smoke-all] ✗  %s FAILED\n" "$label"
  fi
}

# ─── 1. render-configs — no external deps, fastest ─────────────────────────
run_smoke "render-configs"  bash scripts/smoke-render-configs.sh

# ─── 2. prompt-loader — reads files, no API calls ──────────────────────────
run_smoke "prompt-loader"   npx tsx scripts/smoke-prompts.ts

# ─── 3. wizard-forge — structural only (LLM phase skipped if no API key) ───
run_smoke "wizard-forge"    npx tsx scripts/smoke-wizard-forge.ts

# ─── Summary ────────────────────────────────────────────────────────────────

printf "\n══════════════════════════════════════════════════\n"
if [ "$FAIL" -eq 0 ]; then
  echo "  smoke-all — PASS ($PASS / $PASS suites)"
  exit 0
else
  echo "  smoke-all — FAIL ($FAIL of $((PASS + FAIL)) suites failed)"
  exit 1
fi

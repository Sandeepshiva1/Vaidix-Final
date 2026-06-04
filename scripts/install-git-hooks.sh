#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# install-git-hooks.sh — configure git to use the in-repo .githooks directory
# ════════════════════════════════════════════════════════════════════════════
# Run once per clone (or after a clean checkout):
#   ./scripts/install-git-hooks.sh
#
# This sets core.hooksPath so git uses .githooks/ instead of the default
# .git/hooks/. The hooks are committed to the repo, so all contributors get
# the same guards without any per-person ceremony beyond running this script.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/pre-push .githooks/pre-commit

echo "[hooks] Installed — core.hooksPath → .githooks"
echo "[hooks]   pre-push   : blocks direct pushes to master/main"
echo "[hooks]   pre-commit : bash -n syntax check on staged .sh files"
echo ""
echo "[hooks] Run './scripts/install-git-hooks.sh' in every fresh clone."

#!/usr/bin/env bash
# deploy.sh — sync app code (hooks, migrations, frontend) to the production VPS
# and restart PocketBase. Schema/migrations apply automatically on restart.
#
# Data (pb_data/) is NEVER touched by this script — back it up separately.
#
# Usage:
#   scripts/deploy.sh                 # uses defaults below
#   HOST=opc@1.2.3.4 scripts/deploy.sh
set -euo pipefail

HOST="${HOST:-opc@129.158.197.227}"
REMOTE_DIR="${REMOTE_DIR:-/opt/pocketbase}"

cd "$(dirname "$0")/.."

echo "Deploying to ${HOST}:${REMOTE_DIR} ..."

# --rsync-path="sudo rsync" lets rsync write into the pocketbase-owned dir
# (opc has passwordless sudo on the box).
rsync -av --delete --rsync-path="sudo rsync" pb/pb_hooks/      "${HOST}:${REMOTE_DIR}/pb_hooks/"
rsync -av --delete --rsync-path="sudo rsync" pb/pb_migrations/ "${HOST}:${REMOTE_DIR}/pb_migrations/"
rsync -av --delete --rsync-path="sudo rsync" web/              "${HOST}:${REMOTE_DIR}/pb_public/"

ssh "${HOST}" "sudo chown -R pocketbase:pocketbase ${REMOTE_DIR}/pb_hooks ${REMOTE_DIR}/pb_migrations ${REMOTE_DIR}/pb_public && sudo systemctl restart pocketbase"

echo "Done. Service restarted."

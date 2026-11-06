#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/run-fotos-id-share.mjs"

if [ $# -gt 0 ]; then
  node "$RUNNER" "$@"
else
  node "$RUNNER"
fi

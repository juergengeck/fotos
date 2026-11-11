#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/_deploy"

cleanup() {
  rm -rf "$DEPLOY_DIR"
}
trap cleanup EXIT

# Build and assemble marketing at / and the browser app at /app/.
(cd "$SCRIPT_DIR/browser-ui" && node node_modules/vite/bin/vite.js build)
node "$SCRIPT_DIR/scripts/assemble-site.mjs" "$DEPLOY_DIR"

# Deploy fotos.one to Cloudflare Pages
wrangler pages deploy "$DEPLOY_DIR/" --project-name=fotos-one --branch=main

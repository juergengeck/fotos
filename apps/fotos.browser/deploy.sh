#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/_deploy"

cleanup() {
  rm -rf "$DEPLOY_DIR"
}
trap cleanup EXIT

# Build the app at root (no /app/ subpath). Run from browser-ui so Tailwind
# content paths resolve correctly, but bypass the stale generated .bin shim.
(cd "$SCRIPT_DIR/browser-ui" && node node_modules/vite/bin/vite.js build --base=/)

# Assemble deploy directory: app at root, cam.svg as favicon
# Assemble deploy: strip WASM > 25MB (served from refinio.one)
rm -rf "$DEPLOY_DIR"
cp -r "$SCRIPT_DIR/browser-ui/dist" "$DEPLOY_DIR"
find "$DEPLOY_DIR/assets" -name '*.wasm' -size +25M -delete
cp "$SCRIPT_DIR/public/cam.svg" "$DEPLOY_DIR/cam.svg"

# Deploy fotos.one to Cloudflare Pages
wrangler pages deploy "$DEPLOY_DIR/" --project-name=fotos-one --branch=main

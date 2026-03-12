#!/bin/bash
set -e

# Build the app at root (no /app/ subpath)
cd browser-ui && npx vite build --base=/ && cd ..

# Assemble deploy directory: app at root, cam.svg as favicon
# Assemble deploy: strip WASM > 25MB (served from refinio.one)
rm -rf _deploy
cp -r browser-ui/dist _deploy
find _deploy/assets -name '*.wasm' -size +25M -delete
cp public/cam.svg _deploy/cam.svg

# Deploy fotos.one to Cloudflare Pages
wrangler pages deploy _deploy/ --project-name=fotos-one --branch=main

# Cleanup
rm -rf _deploy

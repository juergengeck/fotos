#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEADLESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$HEADLESS_DIR/.." && pwd)"
VGER_ROOT="$(cd "$REPO_ROOT/vger" && pwd)"
VGER_HEADLESS_DIR="$VGER_ROOT/packages/vger.headless"
ONE_CORE_DIR="$(cd "$REPO_ROOT/../one/packages/one.core" && pwd)"

truthy() {
    local normalized
    normalized="$(printf '%s' "${1:-0}" | tr '[:upper:]' '[:lower:]')"
    [ "$normalized" = "1" ] || [ "$normalized" = "true" ] || [ "$normalized" = "yes" ]
}

CONFIG_FILE="${FOTOS_SCHWEIZ_CONFIG:-$HEADLESS_DIR/config/schweiz.env}"

set -a
if [ -f "$CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
fi

: "${SCHWEIZ_HOST:=schweiz}"
: "${SCHWEIZ_PORT:=7100}"
: "${SCHWEIZ_REMOTE_DIR:=/volume2/homes/gecko/fotos.headless}"
: "${SCHWEIZ_STORAGE_DIR:=/volume2/homes/gecko/fotos-headless-data}"
: "${SCHWEIZ_NODE:=/usr/local/bin/node}"
: "${SCHWEIZ_FOTOS_DIR:=/volume2/homes/gecko/Photos}"
: "${SCHWEIZ_LOG_PATH:=$SCHWEIZ_REMOTE_DIR/headless.log}"
: "${SCHWEIZ_PID_PATH:=$SCHWEIZ_REMOTE_DIR/headless.pid}"

: "${VGER_WORKSPACE_ROOT:=$SCHWEIZ_FOTOS_DIR}"
: "${VGER_SKILLS_PLUGINS_PATH:=$SCHWEIZ_REMOTE_DIR/skills}"
: "${VGER_NO_PHONE_BOOK:=1}"
: "${VGER_NO_GLUE_SERVICES:=1}"
: "${TRUST_LOCAL_NETWORK:=1}"
: "${INSTANCE_NAME:=fotos-schweiz}"
: "${VGER_LOCAL_LLAMA_ENABLED:=0}"
: "${VGER_EMBEDDING_RUNTIME_FAMILY:=llama-cpp}"
: "${LLAMA_CPP_EMBED_URL:=http://192.168.178.117:8103}"
: "${LLAMA_CPP_EMBED_MODEL:=gemma-4-e4b-it-vllm}"
: "${VLLM_EMBED_URL:=$LLAMA_CPP_EMBED_URL}"
: "${VLLM_EMBED_MODEL:=$LLAMA_CPP_EMBED_MODEL}"
: "${FOTOS_SKIP_ONE_CORE_BUILD:=0}"
: "${FOTOS_INCLUDE_BROWSER_UI:=0}"

set +a

echo "[fotos.headless] verifying schweiz node runtime at $SCHWEIZ_NODE"
ssh "$SCHWEIZ_HOST" "[ -x '$SCHWEIZ_NODE' ] && '$SCHWEIZ_NODE' --version"

if truthy "${FOTOS_SKIP_ONE_CORE_BUILD:-0}"; then
    echo "[fotos.headless] skipping one.core prebuild for schweiz deploy"
else
    echo "[fotos.headless] building one.core before schweiz bundle"
    pnpm --dir "$ONE_CORE_DIR" build
fi

echo "[fotos.headless] bundling vger.headless for schweiz"
(
    cd "$VGER_HEADLESS_DIR"
    if truthy "${FOTOS_INCLUDE_BROWSER_UI:-0}"; then
        NO_WHATSAPP=1 ./bundle.sh
    else
        NO_WHATSAPP=1 NO_FOTOS=1 ./bundle.sh
    fi
)

echo "[fotos.headless] syncing package and runtime to $SCHWEIZ_HOST:$SCHWEIZ_REMOTE_DIR"
ssh "$SCHWEIZ_HOST" "mkdir -p '$SCHWEIZ_REMOTE_DIR/runtime' '$SCHWEIZ_STORAGE_DIR'"
rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    "$HEADLESS_DIR/" \
    "$SCHWEIZ_HOST:$SCHWEIZ_REMOTE_DIR/"
rsync -az --delete /tmp/vger-deploy/ "$SCHWEIZ_HOST:$SCHWEIZ_REMOTE_DIR/runtime/"

echo "[fotos.headless] restarting schweiz user-space headless on :$SCHWEIZ_PORT"
ssh "$SCHWEIZ_HOST" bash <<EOF
set -euo pipefail
mkdir -p "$SCHWEIZ_REMOTE_DIR" "$SCHWEIZ_STORAGE_DIR"
if [ -f "$SCHWEIZ_PID_PATH" ]; then
    pid="\$(cat "$SCHWEIZ_PID_PATH" 2>/dev/null || true)"
    if [ -n "\$pid" ] && kill -0 "\$pid" 2>/dev/null; then
        kill "\$pid" || true
        sleep 2
    fi
fi
nohup env \
    FOTOS_DIR="$SCHWEIZ_FOTOS_DIR" \
    VGER_WORKSPACE_ROOT="$VGER_WORKSPACE_ROOT" \
    VGER_SKILLS_PLUGINS_PATH="$VGER_SKILLS_PLUGINS_PATH" \
    NO_PHONE_BOOK="$VGER_NO_PHONE_BOOK" \
    NO_GLUE_SERVICES="$VGER_NO_GLUE_SERVICES" \
    TRUST_LOCAL_NETWORK="$TRUST_LOCAL_NETWORK" \
    INSTANCE_NAME="$INSTANCE_NAME" \
    VGER_LOCAL_LLAMA_ENABLED="$VGER_LOCAL_LLAMA_ENABLED" \
    VGER_EMBEDDING_RUNTIME_FAMILY="$VGER_EMBEDDING_RUNTIME_FAMILY" \
    LLAMA_CPP_EMBED_URL="$LLAMA_CPP_EMBED_URL" \
    LLAMA_CPP_EMBED_MODEL="$LLAMA_CPP_EMBED_MODEL" \
    VLLM_EMBED_URL="$VLLM_EMBED_URL" \
    VLLM_EMBED_MODEL="$VLLM_EMBED_MODEL" \
    "$SCHWEIZ_NODE" "$SCHWEIZ_REMOTE_DIR/runtime/bundle.mjs" \
        --host 0.0.0.0 \
        --port "$SCHWEIZ_PORT" \
        --storage "$SCHWEIZ_STORAGE_DIR" \
        --static "$SCHWEIZ_REMOTE_DIR/runtime/html" \
        --fotos-dir "$SCHWEIZ_FOTOS_DIR" \
        > "$SCHWEIZ_LOG_PATH" 2>&1 < /dev/null &
echo \$! > "$SCHWEIZ_PID_PATH"
EOF

echo -n "[fotos.headless] waiting for schweiz health"
for _attempt in $(seq 1 30); do
    if ssh "$SCHWEIZ_HOST" "curl -fsS http://127.0.0.1:$SCHWEIZ_PORT/health >/dev/null"; then
        echo
        break
    fi
    echo -n "."
    sleep 1
done

ssh "$SCHWEIZ_HOST" "curl -fsS http://127.0.0.1:$SCHWEIZ_PORT/health >/dev/null"

route_status="$(ssh "$SCHWEIZ_HOST" "curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' http://127.0.0.1:$SCHWEIZ_PORT/api/fotos/status" || true)"
case "$route_status" in
    200|401|403)
        ;;
    *)
        echo "[fotos.headless] expected schweiz /api/fotos/status to exist after deploy, got HTTP $route_status" >&2
        exit 1
        ;;
esac

echo "[fotos.headless] schweiz deploy is live at http://${SCHWEIZ_HOST#*@}:$SCHWEIZ_PORT"
echo "[fotos.headless] Fotos route check returned HTTP $route_status"

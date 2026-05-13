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

CONFIG_FILE="${FOTOS_SPARK_CONFIG:-$HEADLESS_DIR/config/spark.env}"

set -a
if [ -f "$CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
fi

: "${SPARK_HOST:=gecko@192.168.178.117}"
: "${SPARK_HEADLESS_URL:=http://${SPARK_HOST#*@}:3000}"
: "${SPARK_REMOTE_FOTOS_ROOT:=/home/gecko/fotos}"
: "${SPARK_SYNC_FOTOS_HEADLESS:=1}"
: "${SPARK_START_EMBED_LANE:=1}"
: "${SPARK_EMBED_MODEL_PRESET:=gemma-4-e4b-it}"
: "${SPARK_EMBED_PORT:=8103}"
: "${SPARK_EMBED_CONTAINER_NAME:=spark-vllm-gemma4-e4b-embed}"

: "${FOTOS_PATH:=$SPARK_REMOTE_FOTOS_ROOT}"
: "${VGER_WORKSPACE_ROOT:=/fotos/fotos.headless}"
: "${VGER_SKILLS_PLUGINS_PATH:=/fotos/fotos.headless/skills}"
: "${VGER_NO_PHONE_BOOK:=1}"
: "${VGER_NO_GLUE_SERVICES:=1}"
: "${TRUST_LOCAL_NETWORK:=1}"
: "${VGER_OWNER_EMAIL:=glue}"
: "${VGER_OWNER_PASSWORD:=geheim}"
: "${FOTOS_SKIP_ONE_CORE_BUILD:=0}"

set +a

if truthy "$FOTOS_SKIP_ONE_CORE_BUILD"; then
    echo "[fotos.headless] skipping one.core prebuild for Spark deploy"
else
    echo "[fotos.headless] building one.core before Spark deploy"
    pnpm --dir "$ONE_CORE_DIR" build
fi

if truthy "$SPARK_SYNC_FOTOS_HEADLESS"; then
    echo "[fotos.headless] syncing fotos.headless to $SPARK_HOST:$SPARK_REMOTE_FOTOS_ROOT/fotos.headless"
    ssh "$SPARK_HOST" "mkdir -p '$SPARK_REMOTE_FOTOS_ROOT/fotos.headless'"
    rsync -az --delete \
        --exclude '.git' \
        --exclude 'node_modules' \
        "$HEADLESS_DIR/" \
        "$SPARK_HOST:$SPARK_REMOTE_FOTOS_ROOT/fotos.headless/"
fi

if truthy "$SPARK_START_EMBED_LANE"; then
    echo "[fotos.headless] starting Spark Gemma 4 E4B pooling lane on :$SPARK_EMBED_PORT"
    (
        cd "$VGER_HEADLESS_DIR"
        env -u VLLM_EMBED_MODEL -u VLLM_EMBED_SERVED_MODEL_NAME \
            VLLM_EMBED_MODEL_PRESET="$SPARK_EMBED_MODEL_PRESET" \
            VLLM_EMBED_PORT="$SPARK_EMBED_PORT" \
            VLLM_EMBED_CONTAINER_NAME="$SPARK_EMBED_CONTAINER_NAME" \
            ./deployments/spark/run-vllm-embed.sh "$SPARK_HOST"
    )
fi

echo "[fotos.headless] replacing Spark vger-headless container"
(
    cd "$VGER_HEADLESS_DIR"
    ./deployments/spark-agent/deploy.sh "$SPARK_HOST"
)

echo "[fotos.headless] verifying Spark health"
curl -fsS "${SPARK_HEADLESS_URL%/}/health" >/dev/null

route_status="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' "${SPARK_HEADLESS_URL%/}/api/fotos/status" || true)"
case "$route_status" in
    200|401|403)
        ;;
    *)
        echo "[fotos.headless] expected /api/fotos/status to exist after deploy, got HTTP $route_status" >&2
        exit 1
        ;;
esac

echo "[fotos.headless] Spark deploy is live at $SPARK_HEADLESS_URL"
echo "[fotos.headless] Fotos route check returned HTTP $route_status"

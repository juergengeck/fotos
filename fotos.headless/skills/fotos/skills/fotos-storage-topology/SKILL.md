---
name: fotos-storage-topology
description: Use when working on the split Fotos headless runtime where schweiz owns the photo tree and spark provides Gemma 4 E4B semantic compute. Covers deploy entrypoints, workspace roots, and the no-legacy storage/compute split.
---

# Fotos Storage Topology

Use this when the task touches `fotos.headless`, `vger.headless`, or Fotos agent workflows across `spark` and `schweiz`.

## Runtime Roles

- `schweiz` is the storage-side runtime.
- `spark` is the compute-side runtime.
- There is no legacy Fotos headless path to preserve.

Keep these boundaries stable:

- `schweiz` owns the live photo tree and writes portable `one/index.html`.
- `spark` owns Gemma 4 E4B image-embedding compute and semantic-carrier experiments.
- `fotos.browser` and `fotos.expo` remain first-class clients and should consume the same metadata shape.

## Deploy Entry Points

- Spark: `/Users/gecko/src/fotos/fotos.headless/scripts/deploy-spark.sh`
- Schweiz: `/Users/gecko/src/fotos/fotos.headless/scripts/deploy-schweiz.sh`

Load `config/spark.env` or `config/schweiz.env` first when machine-local overrides are needed.

## Workspace And Skills

The agent runner should always see an explicit workspace root and skills path.

- Spark workspace root: `/fotos/fotos.headless`
- Spark skills path: `/fotos/fotos.headless/skills`
- Schweiz workspace root: `/volume2/homes/gecko/Photos`
- Schweiz skills path: `/volume2/homes/gecko/fotos.headless/skills`

For Spark container deploys, keep `FOTOS_PATH=/home/gecko/fotos` so the synced
`fotos.headless` package lands under `/fotos/fotos.headless` inside the
container.

For Schweiz user-space deploys, point `VGER_WORKSPACE_ROOT` directly at the
photo tree. The skills live beside the runtime bundle, not inside the photo
library.

## Semantic Lane Rules

Keep the plain text lane and the semantic lane distinct on Spark:

- `gemma4:e4b` stays the plain shared lane.
- `gemma4:e4b:semantic` is the sibling lane for semantic carriers.
- `VLLM_TEXT_INTERPRETER_INPUT_TRANSPORT=metadata-only` on the plain lane.
- `VLLM_TEXT_SEMANTIC_INTERPRETER_INPUT_TRANSPORT=vllm-image-embeds-v1` on the semantic lane.
- `VLLM_TEXT_MM_EMBEDS_PATCH=gemma4-image-embeds-v1` only on the semantic-capable path.

When Schweiz needs embeddings, route it to Spark through
`LLAMA_CPP_EMBED_URL` / `LLAMA_CPP_EMBED_MODEL` rather than enabling local
compute on the NAS.

## Safe Defaults

- Do not mutate the canonical library first when validating a new semantic pass.
- Use the batch runner to write into a dedicated test folder under the Schweiz photo root.
- Prefer health checks and route-presence checks after deploys:
  - `/health`
  - `/api/fotos/status` should stop returning `404`

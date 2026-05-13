---
name: fotos-semantic-batch
description: Use when running or validating a Fotos semantic embedding batch that stages sample media from schweiz, computes Gemma 4 E4B image embeddings on spark, and writes portable semantic attrs into one/index.html.
---

# Fotos Semantic Batch

Use this when you need a small end-to-end semantic batch for Fotos.

## What It Does

`/Users/gecko/src/fotos/fotos.headless/scripts/run-test-batch.mjs`:

- selects a small sample from `schweiz`
- copies the media into a safe local staging folder
- calls Spark's pooling endpoint for Gemma 4 E4B image embeddings
- normalizes and base64-encodes the vectors for Fotos metadata
- writes a portable `one/index.html`
- uploads the finished batch into a dedicated test folder on `schweiz`

It does not mutate the canonical library root directly.

## Inputs

Configure the run through `config/batch.env` or environment overrides:

- `SCHWEIZ_SOURCE_DIR`
- `SCHWEIZ_TEST_BATCH_DIR`
- `SPARK_EMBED_BASE_URL`
- `SPARK_EMBED_MODEL`
- `TEST_BATCH_LIMIT`

## Expected Output

The uploaded batch should contain:

- copied sample media files
- `one/index.html`
- `batch-summary.json`

Each image row should carry:

- `data-content-hash`
- `data-semantic-model-id`
- `data-semantic-embedding`

## Workflow

1. Make sure `spark` has the E4B embedding lane up.
2. Run `node /Users/gecko/src/fotos/fotos.headless/scripts/run-test-batch.mjs`.
3. Confirm the summary points at the Schweiz test folder, not the live library root.
4. If a deployed Schweiz headless URL is available, confirm `/health` and `/api/fotos/status` are reachable.

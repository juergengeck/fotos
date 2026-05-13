# fotos.headless

`fotos.headless` is the split headless runtime wrapper for Fotos.

Topology:

- `schweiz` is the storage-facing headless that serves the photo tree and writes `one/index.html`.
- `spark` is the compute-facing headless that advertises the Gemma 4 E4B semantic lane and hosts the image-embedding runtime.
- `fotos.browser` and `fotos.expo` stay the primary user surfaces; this package gives them a shared server-side complement.

Included here:

- deploy wrappers for `spark` and `schweiz`
- config examples for both machines plus batch runs
- Fotos skill plugins for the VGER agent runner
- a semantic smoke-batch script that stages a safe sample from `schweiz`, embeds it on `spark`, and pushes the result back as a portable test folder

By default the `schweiz` wrapper ships a headless-only bundle and does not
side-build `fotos.browser`. Set `FOTOS_INCLUDE_BROWSER_UI=1` in
`config/schweiz.env` if you explicitly want `/fotos/` static assets embedded
into the same runtime bundle.

Typical usage:

```bash
cd /Users/gecko/src/fotos/fotos.headless
cp config/spark.env.example config/spark.env
cp config/schweiz.env.example config/schweiz.env
cp config/batch.env.example config/batch.env
pnpm deploy:spark
pnpm deploy:schweiz
pnpm test:batch
```

# fotos.browser

Privacy-first photo management with face recognition. Runs entirely in the browser — no server uploads, no cloud storage. Syncs between your devices via encrypted CHUM.

**Live**: https://fotos.one
**Deploy**: Cloudflare Pages (`fotos-one`)

> *we do not want your fotos.*
> *use our software, keep them.*

## What it does

- Open any image folder — extracts EXIF, generates thumbnails, detects and clusters faces
- Writes `one/` metadata sidecars alongside your photos — portable, no lock-in
- Syncs photo metadata between your trusted devices via ONE.core CHUM
- Mobile ingests lightweight (hash + EXIF + thumbs), desktop enriches (faces), enrichment flows back
- PWA with share target — share photos from your gallery app directly into fotos.one

## Quick start

```bash
cd /Users/gecko/src/vger
ONNXRUNTIME_NODE_INSTALL=skip pnpm install

cd packages/fotos.browser/browser-ui
pnpm dev          # http://localhost:5188
```

## Deploy

```bash
cd packages/fotos.browser
./deploy.sh       # builds, strips large WASM, deploys to Cloudflare Pages
```

## Architecture

```
fotos.browser (any device)        glue.one headless (phone book only)
        │                                   │
        ├── pair (presence + certs) ───────>│
        │                                   │
        │<── CHUM (commserver relay) ──────>│ ← NO photo content relay
        │                                   │
    FotosEntry objects                   profiles, certs, presence
    thumbnail + face BLOBs              (phoneBookMode = true)
    (trusted device-to-device)
```

ONE.core boots in the browser (IndexedDB + Web Crypto). The commserver relays encrypted CHUM traffic between paired devices. The headless is phone book only — it syncs profiles, certs, and presence but never sees photo content.

## Directory structure

```
fotos.browser/
├── public/                     Landing page assets
│   ├── cam.svg                 Camera icon / favicon
│   └── apple-touch-icon.png
│
├── browser-ui/                 React/Vite app
│   ├── src/
│   │   ├── main.tsx            Entry: ONE.core platform → boot → React
│   │   ├── App.tsx             Root: attach/select flow → gallery → lightbox
│   │   ├── sw.ts               Service worker (Workbox + share target)
│   │   ├── config.ts           API_BASE, COMM_SERVER_URL
│   │   │
│   │   ├── lib/
│   │   │   ├── onecore-boot.ts     ONE.core init (MultiUser, modules, identity)
│   │   │   ├── browserIngest.ts    EXIF, thumbnails, content hashing
│   │   │   ├── faceWorkerClient.ts Promise-based Web Worker bridge
│   │   │   ├── fotos-manifest.ts   FotosManifest CRUD + access grants
│   │   │   ├── fotos-sync.ts       PhotoEntry ↔ FotosEntry, CHUM listener
│   │   │   ├── glueIdentity.ts     Publication identity management
│   │   │   ├── platform.ts         isMobile(), Web Share API
│   │   │   ├── FotosPlan.ts        Face detection plan (PlanRegistry)
│   │   │   ├── PlanRegistry.ts     Local plan registry
│   │   │   └── qrcode.ts           QR generation for face cluster URLs
│   │   │
│   │   ├── hooks/
│   │   │   ├── useFolderAccess.ts  Library attach, selection capture, restore, share target
│   │   │   ├── useGallery.ts       Filtering, face search, day groups
│   │   │   └── useSettings.ts      settings.core-backed persistence with local fallback
│   │   │
│   │   ├── components/
│   │   │   ├── PhotoGrid.tsx       Day-grouped thumbnail grid
│   │   │   ├── Lightbox.tsx        Full-size viewer (zoom, pan, rotate, face crops)
│   │   │   ├── Sidebar.tsx         Tags, search, settings (portrait/landscape responsive)
│   │   │   ├── TimelineScrubber.tsx Year/month timeline
│   │   │   ├── FotosSettings.tsx   Glue identity, passkeys, connection status
│   │   │   ├── UpdatePrompt.tsx    SW update notification banner
│   │   │   └── Impressum.tsx       Legal info
│   │   │
│   │   └── workers/
│   │       └── face.worker.ts      ONNX inference (RetinaFace + ArcFace)
│   │
│   ├── vite.config.ts          Plugins, aliases, PWA config
│   └── vite-plugin-fotos-api.ts Dev HTTP→HMR bridge
│
└── deploy.sh                   Cloudflare Pages deploy
```

## Data flow

### Desktop attach

```
attach photo library → walk directories → find one/index.html?
  ├── yes → parse entries, load face/cluster data
  └── no  → scan images → EXIF → thumbnail → hash → faces → clustering
            write one/index.html + one/thumbs/ + one/faces/ + one/clusters.json
                ↓
            create FotosEntry objects in ONE.core → add to FotosManifest
```

### Mobile capture

```
photo picker / share target → hash + EXIF + thumb (no face detection)
  ↓
create FotosEntry in ONE.core → add to FotosManifest
  ↓
receive face enrichment from desktop via CHUM → update local state
```

### Device sync

```
device A (desktop)                    device B (mobile)
  FotosEntry with faces                 FotosEntry without faces
        │                                      │
        └──── CHUM via commserver ────────────>│
                                          merge face data
                                          write one/index.html + one/faces/
```

## Face detection pipeline

1. **RetinaFace** (det_10g.onnx) — bounding boxes + 5-point landmarks
2. **ArcFace** (w600k_r50.onnx) — 512-dimensional embedding per face
3. **HNSW clustering** — cosine similarity on centroids, 0.55 threshold
4. Crops written to `one/faces/`, embeddings in `data-face-embeddings` attributes
5. Cluster state persisted to `one/clusters.json` for instant restore

Runs in a Web Worker. Tries WebGPU first, falls back to WASM.

See [Face Cluster Design](../../docs/plans/2026-03-08-face-cluster-design.md).

## ONE.core recipes

### FotosEntry (versioned)

Photo metadata. `contentHash` is the identity key (`isId`) — all instances converge on the same object regardless of which device created it.

Fields: contentHash, streamId, mime, size, EXIF (date, camera, lens, focal, aperture, shutter, iso, gps, dimensions), thumb BLOB, faceCount, faceEmbeddings BLOB, faceCrops BLOB.

### FotosManifest (versioned singleton)

Fixed id `'fotos'` — deterministic idHash across all instances. Contains `Set<SHA256Hash<FotosEntry>>` using `referenceToObj` for CHUM traversal. IdAccess grants on this manifest gate who can sync.

## Trust model

FotosManifest access is granted via `fotosAccessGranter` on ConnectionModule, firing in the same three gated paths as GlueShareManifest:

1. `registerPairingHandler` → onProtocolStart
2. `handleGlueProfileCredential` → glueOnProtocolStart
3. `startChumForPeer` → glueOnProtocolStart

All paths gated by `!phoneBookMode` — the headless never grants fotos access.

## Mobile mode

Detected via `pointer: coarse && (standalone || max-width: 768px)`.

| Aspect | Portrait | Landscape |
|--------|----------|-----------|
| Layout | Grid above, sidebar below | Grid left, sidebar right |
| Ingestion | Hash + EXIF + thumbs | Same |
| Face detection | Skipped (receives from desktop) | Same |
| Photo tap | Native share sheet | Same |

## PWA

- **Installable** — standalone display, home screen icon
- **Offline** — Workbox precaches static assets (js, css, svg, png, woff2)
- **Share target** — installed PWA appears in native share sheet; photos shared to fotos.one are stashed by the SW and ingested on app launch
- **Auto-update** — checks on focus, visibility change, every 2min; shows banner when new version ready

## Folder persistence

Last-opened folder is saved to IndexedDB. On desktop reload, if the browser still has `readwrite` permission, the folder reopens automatically.

## Dev tools

```bash
# Browser console
window.__api('fotos', 'status')       # plan status
window.__api('fotos', 'init')         # init face worker
window.__planRegistry                  # inspect registry

# HTTP API (dev only, via vite-plugin-fotos-api)
curl -X POST http://localhost:5188/api/fotos/init
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@refinio/fotos.core` | Face detection, clustering (HNSW), ONE.core recipes |
| `@refinio/one.core` | Content-addressed storage, crypto, CHUM sync |
| `@refinio/one.models` | MultiUser authenticator, domain models |
| `@refinio/connection.core` | Device pairing, manifest access grants |
| `@refinio/trust.core` | Trust verification |
| `@refinio/settings.core` | Settings management |
| `@vger/vger.core` | ModuleRegistry, CoreModule, ConnectionModule |
| `@vger/vger.glue` | GlueModule (presence, discovery) |
| `@glueone/glue.core` | Presence, registration, ownership proofs |
| `onnxruntime-web` | ONNX inference (WebGPU/WASM) |
| `exifreader` | Browser EXIF extraction |
| `react` / `tailwindcss` | UI |
| `vite-plugin-pwa` / `workbox-*` | PWA, offline, share target |
| `@simplewebauthn/browser` | WebAuthn passkey management |

## Implementation status

| Phase | What | Status |
|-------|------|--------|
| 1: Boot | ONE.core in browser, identity, settings, passkeys | Done |
| 2: Ingest → ONE.core | FotosManifest + FotosEntry from ingested photos | Done |
| 3: CHUM sync | Trust-gated sync between devices, receive enrichment | Done |
| 4: Filesystem merge | Write received face data to one/index.html + one/faces/ | Done |

Design: [fotos-federation-design.md](../../docs/plans/2026-03-08-fotos-federation-design.md)
Plan: [fotos-federation-implementation.md](../../docs/plans/2026-03-08-fotos-federation-implementation.md)

# Fotos Service Contract

This is the shared service boundary that should align:

- `vger.headless` as the remote/filesystem fotos adapter
- `fotos.expo` as the native/Photos-library fotos adapter
- browser or HTML viewers that consume a fotos source

The contract is encoded in [`@refinio/fotos.core`](../fotos.core/src/service-contract.ts).

The persistence model that should sit underneath this contract is described in
[`fotos-media-model.md`](./fotos-media-model.md).

## Purpose

The UI should not need to care whether a fotos source comes from:

- a headless server serving a desktop folder
- a local iOS adapter reading the photo library
- a future peer-backed manifest source

Those implementations can have different media backends, but they should present the same fotos runtime surface above that line.

## Current canonical methods

These method names match the existing `vger.headless` fotos plan:

- `fotos:status`
- `fotos:ingest`
- `fotos:pause`
- `fotos:resume`
- `fotos:browse`
- `fotos:folders`

Binary resources remain route-based:

- `/fotos/thumb/:relativePath`
- `/fotos/file/:relativePath`

## Shared data shapes

The contract defines shared types for:

- `FotosServiceEntry`
- `FotosFolderMetadata`
- `FotosIngestStatus`
- `FotosServiceBrowseData`
- `FotosServiceStatusData`

That lets different consumers agree on:

- folder navigation
- ingest/run state
- photo entry metadata
- face sidecar payload transport

## Backend-specific responsibilities

### `vger.headless`

- owns filesystem walking
- owns `one/index.html` parsing and writing
- owns desktop-oriented ingest/resume behavior
- serves thumbs and file bytes over HTTP

### `fotos.expo`

- should own Photos / picker / share-extension intake
- should map native asset reachability to canonical fotos content hashes
- should persist native locators separately from shared media identity
- should expose the same browse/status/ingest surface to local UI
- should keep trust, CHUM, user, and device management in the existing ONE runtime

## What should stay different

The contract does not require identical storage internals.

- headless can think in paths, folders, and `one/index.html`
- Expo can think in `PHAsset` ids, content hashes, App Group storage, and local manifests

What should match is the fotos behavior layer:

- ingest modes
- browse semantics
- run lifecycle
- metadata payload shape
- trust and sharing policy

## Media identity boundary

The service contract should move canonical media identity and derived-media
knowledge across runtimes, not platform-specific locators.

That means:

- `contentHash` identifies the media
- thumbnails, crops, previews, and edits are separate variants with their own hashes
- locators stay runtime-specific and are used only to reacquire bytes locally

This is the reason the same analysis output can be reused when the same image
reappears on another device or platform.

## Settings-first implication

If the contract is shared, the app can stay small.

The main product surface becomes:

- native Photos for local browsing and selection
- fotos settings for intake, sharing, analysis, sync, and run policy
- small dedicated runtime screens for trust, devices, and active runs

That is the intended direction for `fotos.expo`.

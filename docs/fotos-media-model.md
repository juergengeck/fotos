# Fotos Media Model

This is the persistence split we are building toward for `fotos.one`.

It starts from one hard rule:

- `contentHash` is the media identity

That identity is device-agnostic and platform-agnostic. Local asset ids, file
paths, browser handles, and URLs are reachability data, not identity.

## What the browser already proves

`fotos.browser` already does the first important part correctly:

- it hashes image payload bytes
- for JPEG, it strips APP/COM metadata before hashing
- it stores that as `data-content-hash`

Relevant code:

- [`browserIngest.ts`](../fotos.browser/browser-ui/src/lib/browserIngest.ts)
- [`fotos-sync.ts`](../fotos.browser/browser-ui/src/lib/fotos-sync.ts)

That means the same image can converge even if headers or container metadata
were rewritten.

Today there is also one important limit to keep in view:

- browser ingest computes a secondary `streamId`
- the current ONE sync path still persists `streamId = contentHash`

So the new variant and locator layer is where richer media-family semantics can
grow without losing the existing content-addressed convergence.

The shared normalization rule now lives in
[`content-hash.ts`](../fotos.core/src/content-hash.ts), so Expo can reuse the
same JPEG metadata stripping behavior instead of inventing its own mobile hash.

## Layers

### 1. Canonical media anchor

[`FotosEntry`](../fotos.core/src/recipes/FotosRecipes.ts) remains the canonical
fotos object for a media item.

- key: `contentHash`
- purpose: shared metadata, sync convergence, family anchor

In practice this is the object we expect an `Assembly` history to accumulate
around as more is learned about a piece of media.

### 2. Concrete media variants

[`FotosMediaVariant`](../fotos.core/src/recipes/FotosMediaRecipes.ts) represents
a concrete known blob related to that anchor.

Examples:

- original image payload
- thumbnail
- preview
- transcode
- edited rendition
- face crop

Each variant has its own `contentHash`. Different bytes mean a different
variant. Variants point back to the canonical `FotosEntry` family anchor and
can point to another variant via `derivedFrom`.

This is the place where thumbnails stop being awkward special cases.

### 3. Locators

[`FotosMediaLocator`](../fotos.core/src/recipes/FotosMediaRecipes.ts) represents
how a runtime can reacquire bytes for a variant.

Examples:

- iOS `PHAsset` identifier
- Android media-store entry
- filesystem path
- browser file handle scope
- headless `one/` relative path
- URL or ONE blob reference

Locators are explicitly not identity. They are runtime- and device-specific.

## Why this split matters

The system has to hold several concerns at once:

- discovery and synchronization between devices
- local addressing and reachability
- navigation and hierarchy
- media and derived artifacts
- rights, authenticity, and compliance

Those concerns need to connect, but they should not collapse into one object.

The stable center should stay small:

- `FotosEntry` for canonical media identity
- `FotosMediaVariant` for concrete related blobs
- `FotosMediaLocator` for platform-specific reachability

## Relationship to `knowledge.core`

`knowledge.core` already gives us `Artifact` as a content-addressed semantic
blob type.

The intended alignment is:

- `Artifact` for a concrete content-addressed blob
- `FotosMediaVariant` for fotos-specific media semantics around that blob
- `FotosEntry` for the canonical fotos family anchor

In other words, the fotos model should not fight `knowledge.core`; it should
give fotos-specific structure to media families and derived renditions.

## Relationship to `assembly.core`

`assembly.core` is the right place to track durable history over time.

The expected direction is:

- `Assembly(entity = FotosEntry)` for the evolving known state of a media family
- stories recording ingest, analysis, locator verification, rights changes,
  or newly accepted derivatives

This document does not define the full assembly flow yet. It only makes the
anchor points explicit so that work can land there cleanly.

## Scope we are intentionally not freezing yet

We are not defining every future recipe right now.

Still intentionally open:

- navigation and hierarchy projections
- compliance / rights policy objects
- authenticity and provenance chains beyond current attestations
- how browser `streamId` should relate to long-lived media-family semantics
- exact device-local storage policy for Expo / App Group / Photos integration

## First implementation now in tree

The first concrete model lives in:

- [`FotosRecipes.ts`](../fotos.core/src/recipes/FotosRecipes.ts)
- [`FotosMediaRecipes.ts`](../fotos.core/src/recipes/FotosMediaRecipes.ts)

That gives Expo, browser, and headless runtimes a shared place to persist:

- canonical media records
- known derived variants
- runtime-specific locators

Current browser status:

- `fotos.browser` sync now stores an `original` `FotosMediaVariant` for each
  synced `FotosEntry`
- when a thumbnail blob is present it also stores a `thumbnail` variant
- browser-relative source and thumbnail paths are stored as local
  `FotosMediaLocator` objects

Current Expo status:

- `fotos.expo` can sync recent iOS photo-library assets into the ONE runtime
- `fotos.expo` can also ingest explicitly picked iOS library assets through the
  native picker path
- `fotos.expo` now also has a share-extension inbox path backed by an App Group;
  the extension writes batches into `group.fotos.ios`, and the main app imports
  them through the same sync service
- each synced item stores the canonical `FotosEntry`
- it also stores an `original` `FotosMediaVariant`
- and it persists either the iOS `PHAsset` identifier or the shared-file cache
  path as a device-local `FotosMediaLocator`

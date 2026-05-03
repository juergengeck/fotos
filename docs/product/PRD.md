# fotos Product Requirements Document

Status: Draft
Owner: fotos product and engineering
Last updated: 2026-04-29
Related: [MRD](./MRD.md)

## 1. Product Summary

fotos is a browser/PWA photo library that lets users attach local folders, generate portable `one/` metadata, browse and search photos, optionally run on-device face and semantic analysis, sync metadata between trusted devices, and share selected gallery content with trusted ONE/glue contacts.

The product has three surfaces:
- `fotos.browser`: primary fotos.one PWA and sync client.
- `fotos.html`: portable fallback viewer and plugin entrypoint for `one/` folders.
- Shared packages: `fotos.core`, `fotos.ui`, and `fotos.gallery` for ingest, analysis, gallery state, recipes, and UI primitives.

## 2. Goals

- Let a user open an existing photo folder and get a useful gallery without uploading originals.
- Persist durable, portable metadata in `one/` folders beside the user's media.
- Provide private, opt-in face analytics and semantic search.
- Support mobile ingest through an installable PWA and share target.
- Sync photo metadata, thumbnails, and enrichment between trusted devices.
- Allow selective sharing of galleries, collections, and face/person clusters with trusted contacts.
- Provide fotos id creation and recovery flows that use private photo-derived proofs.
- Keep a portable fallback viewer path so archives remain browsable without fotos.one.

## 3. Non-Goals

- Cloud backup of original photo libraries.
- Public social feeds, comments, likes, or public profile pages.
- Server-side media analysis.
- Native iOS or Android apps for the first release.
- Full RAW development or destructive image editing.
- Automatic sharing to unverified or anonymous recipients.

## 4. User Personas

- Family archivist: wants private people search, timeline browsing, and family sharing.
- Local-first creator: wants a non-destructive viewer over an existing filesystem archive.
- Mobile capture user: wants to share photos into a private library from the phone gallery.
- Trusted recipient: wants accepted incoming shared photos without broad account setup.
- ONE ecosystem user: wants fotos id, passkeys, and recovery tied to the same identity graph.

## 5. Release Scope

### Current Baseline

The repo already contains:
- Browser/PWA app with local folder attach, photo grid, sidebar, lightbox, timeline, settings, and service worker.
- `one/` metadata parsing/writing with thumbnails, face crops, cluster state, and EXIF.
- On-device face worker using RetinaFace and ArcFace through ONNX runtime.
- Semantic worker and text/image embedding flow for semantic search.
- Collections and sharing assignments.
- ONE.core recipes for `FotosEntry` and `FotosManifest`.
- CHUM sync and trust-gated fotos manifest access.
- fotos id popup and recovery-related helpers.
- Portable `fotos.html` viewer component and server-backed fallback app.

### Productization Focus

This PRD treats those capabilities as the product baseline and specifies the behavior required to make them coherent, testable, and releasable.

## 6. Functional Requirements

| ID | Area | Requirement | Priority | Status |
| --- | --- | --- | --- | --- |
| PRD-01 | Library attach | Users can choose a local folder, grant read/write access, and scan nested image folders. | Must | Current |
| PRD-02 | Restore | fotos remembers the last folder and reopens it when browser permission is still available. | Must | Current |
| PRD-03 | Ingest | fotos extracts EXIF, computes content hashes, generates thumbnails, records size, MIME type, dates, and paths. | Must | Current |
| PRD-04 | Sidecars | fotos writes metadata under `one/`, including `one/index.html`, `one/thumbs/`, `one/faces/`, and cluster state. | Must | Current |
| PRD-05 | Existing metadata | fotos parses existing `one/index.html` data attributes and restores faces, semantic data, thumbnails, and entries. | Must | Current |
| PRD-06 | Gallery | Users can browse day-grouped thumbnails, sort by date/name/added, resize thumbnails, and filter by tags/search. | Must | Current |
| PRD-07 | Timeline | Users can navigate dense date ranges through a year/month timeline scrubber. | Should | Current |
| PRD-08 | Lightbox | Users can open full-size media, zoom, pan, rotate, flip, navigate, export, delete, and inspect EXIF/face details. | Must | Current |
| PRD-09 | Face analysis | Users can enable on-device face detection, embeddings, crops, and clustering. | Must | Current |
| PRD-10 | Face management | Users can rename faces, delete faces, merge clusters, group clusters as a person, separate groups, and search similar faces. | Should | Current |
| PRD-11 | Semantic search | Users can enable local semantic embeddings and search by natural language text. | Should | Current |
| PRD-12 | Collections | Users can select photos or clusters, create collections, rename/delete collections, and browse collection matches. | Should | Current |
| PRD-13 | Sharing | Users can share gallery, collection, or cluster access with selected trusted contacts. | Should | Current |
| PRD-14 | Incoming sharing | Users can opt into accepting shared fotos content and see remote metadata materialized in the gallery. | Should | Current |
| PRD-15 | Sync | fotos syncs `FotosManifest` and `FotosEntry` objects through trust-gated ONE.core CHUM. | Must | Current |
| PRD-16 | Mobile ingest | Installed PWA appears as a share target and ingests shared files into a chosen local destination. | Must | Current |
| PRD-17 | Mobile enrichment | Mobile ingest stays lightweight and can receive desktop face enrichment later. | Should | Current |
| PRD-18 | Identity | Users can certify a fotos/glue identity, use passkeys, disable sync, and manage identity state in settings. | Must | Current |
| PRD-19 | Recovery | Users can configure or use fotos id recovery with photo-derived private factors and recovery-key fallback. | Should | Current |
| PRD-20 | Fallback viewer | `fotos.html` exposes a reusable viewer and remains the canonical target for portable local archives. | Should | Partial |
| PRD-21 | Diagnostics | Development builds expose diagnostics for status, sync, gallery state, and local picker flows. | Could | Current |

## 7. Core User Flows

### 7.1 First-Time Desktop Library Attach

1. User opens fotos.one.
2. User chooses a local photo folder.
3. fotos requests read/write permission.
4. fotos scans nested images and existing `one/` metadata.
5. If metadata is missing, fotos ingests images, writes thumbnails and `one/index.html`, and shows progress.
6. Gallery appears grouped by capture day.
7. User can enable face analytics or semantic search from settings.

Acceptance criteria:
- User sees progress during scan/processing/writing.
- Existing folders with `one/index.html` load without reprocessing all images.
- Failed files do not abort the whole library.
- Original media is not moved or uploaded.

### 7.2 Browsing And Search

1. User browses date-grouped thumbnails.
2. User adjusts thumbnail scale and sort order.
3. User searches by file name, tags, camera/date metadata, face similarity, or semantic query when enabled.
4. User opens a lightbox for detail review.

Acceptance criteria:
- Search and filters update without losing folder state.
- Empty states distinguish "no folder", "loading", and "no matching results".
- Keyboard navigation works in the grid and lightbox.

### 7.3 Face Analysis And People Management

1. User enables face analytics.
2. fotos downloads or initializes required local models.
3. Desktop-capable surfaces analyze missing photos.
4. fotos writes face crops, embeddings, cluster ids, names, and person ids into sidecar metadata.
5. User renames, merges, deletes, groups, separates, or searches similar faces.

Acceptance criteria:
- Analysis is opt-in.
- Progress includes current phase and current file where available.
- Reanalysis can clear stale face or semantic metadata.
- Cluster sensitivity can be adjusted and persisted.

### 7.4 Mobile Share Target Import

1. User installs fotos.one as a PWA.
2. User shares photos from the native gallery to fotos.
3. fotos stores pending shared files until a destination folder is available.
4. User selects or restores an import destination.
5. fotos copies files, computes metadata, and shows imported photos.

Acceptance criteria:
- Pending imports survive app launch handoff.
- Duplicate names are handled safely.
- Mobile does not require local face analysis.

### 7.5 Trusted Device Sync

1. User signs in or certifies a fotos/glue identity.
2. User pairs or connects trusted devices.
3. fotos grants manifest access only for trusted, accepted peers.
4. Metadata, thumbnails, and enrichment sync through CHUM.
5. Remote entries appear locally and local sidecars are updated when appropriate.

Acceptance criteria:
- Sync is off unless explicitly enabled through identity state.
- Headless/phone-book mode never receives broad fotos access.
- Incoming content respects trust filters and sharing acceptance.
- Desktop enrichment can update mobile-ingested entries.

### 7.6 Selective Sharing

1. User creates a collection or selects a person/cluster.
2. User chooses trusted contacts in the share field.
3. fotos records share assignments and grants access for newly added peers.
4. Recipient accepts sharing and can receive shared metadata.

Acceptance criteria:
- Users can share whole gallery, collection, or cluster scopes independently.
- Revocation/removal updates local assignment state.
- UI indicates when sharing is disabled because sync or identity is unavailable.

### 7.7 fotos id And Recovery

1. User enters the fotos id section.
2. User signs in or certifies a glue.one identity.
3. User can add a passkey for faster future authentication.
4. User configures recovery with selected private photos and passphrase/date factor.
5. External apps can open the fotos id popup for create or recover mode through postMessage.

Acceptance criteria:
- Recovery photos never upload.
- Popup accepts only allowed origins plus development origins.
- Result messages include request id and success/error state.
- Recovery verifies the derived signer before server recovery submission.

### 7.8 Portable Fallback Viewer

1. fotos writes or packages a fallback viewer into `one/` metadata.
2. User opens the archive without fotos.one.
3. Viewer reads sidecar metadata and renders a useful gallery.

Acceptance criteria:
- Fallback viewer can be served from local files or a simple static server.
- It does not require ONE.core sync to browse local metadata.
- Generated `one/index.html` and `fotos.html` converge on one canonical format.

## 8. Data And Storage Requirements

- Metadata folders are always named `one/`.
- Photo identity is content-hash based where possible.
- `PhotoEntry` includes hash, name, managed mode, source/folder path, MIME type, thumbnail, tags, capture/update dates, EXIF, size, faces, and semantic info.
- Face info includes count, bounding boxes, scores, embeddings, crop paths, cluster ids, names, person ids, and optional QR paths.
- `FotosEntry` is the syncable ONE.core metadata object keyed by `contentHash`.
- `FotosManifest` is the fixed-id sync root containing `FotosEntry` references.
- Library collections and sharing assignments are versioned app state and must tolerate malformed or older stored values.

## 9. Privacy, Security, And Trust Requirements

- Core gallery use must not require uploading originals.
- Face and semantic analysis must run locally in the browser or local runtime.
- Model downloads must be tied to explicit user settings.
- Sync must require certified identity and trust-gated access grants.
- The headless service may support discovery, presence, certificates, and relay, but must not become a hidden photo library.
- Share recipients must be named or verified peers where possible.
- fotos id popup communication must validate origin, request id, mode, challenge data, and expected public key.
- Recovery factors must be described as private and reproducible; the app must not imply fotos can recover them for the user.

## 10. Performance And Reliability Requirements

- Initial gallery load should prioritize visible thumbnails and usable navigation over complete background enrichment.
- Ingest should stream progress by phase and avoid blocking the UI thread for long work.
- Face and semantic analysis should run in workers.
- Reopening a previously permitted folder should avoid unnecessary full re-ingest.
- Large libraries should rely on trie/grouping indexes for date, folder, tag, person, and face projections.
- Sync merges should be idempotent by content hash.
- Failed analysis or sync of one item should not corrupt the rest of the library.

## 11. UX Requirements

- The first screen should be the usable gallery/intake experience, not a marketing landing page.
- Empty states should provide the next action: open folder, choose import destination, or clear filters.
- Settings must clearly separate storage, display, analysis, identity, sharing, and history behaviors.
- Mobile layout must support portrait and landscape without requiring desktop sidebars.
- Destructive actions such as delete and clearing analysis must be explicit.
- Background work must have concise status and avoid noisy technical logs in the user UI.
- The product voice should be calm, direct, and privacy confident.

## 12. Accessibility Requirements

- Primary controls must be keyboard reachable.
- Lightbox navigation must support keyboard controls.
- Icon buttons need accessible names or titles.
- Focus should remain predictable when opening and closing lightbox or settings panels.
- Text contrast must be sufficient in dark UI contexts.
- Progress states should expose text equivalents.

## 13. Milestones

### M1: Coherent Local Library

Required:
- Folder attach/restore.
- Ingest and `one/` sidecars.
- Gallery, search, timeline, and lightbox.
- Rescan and delete/export basics.

### M2: Private Intelligence

Required:
- Face analytics opt-in.
- Cluster management.
- Semantic search opt-in.
- Reanalysis and settings persistence.

### M3: PWA And Sync

Required:
- PWA install/offline/update behavior.
- Share target import.
- Identity certification.
- CHUM metadata sync and mobile enrichment.

### M4: Trusted Sharing

Required:
- Gallery/collection/cluster share assignments.
- Accept incoming sharing preference.
- Contact/peer resolution.
- Trust-gated access grant auditing.

### M5: Portable Archive And fotos id

Required:
- Canonical `fotos.html` fallback packaging.
- fotos id create/recover popup hardening.
- Recovery status and passkey convenience polished in settings.

## 14. Testing Requirements

- Unit tests for gallery filtering, grouping, settings serialization, face labels, collection matching, sharing policy, photo routes, and sync rules.
- Ingest tests for hashing, EXIF, pipeline behavior, and index HTML parsing/writing.
- Face cluster tests for assignment, merge, sensitivity, and metadata rebuild.
- Popup tests for fotos id origin filtering, postMessage protocol, create mode, and recover mode.
- Browser integration tests for share target and live sync where feasible.
- Typecheck all packages before release.
- Manual smoke tests on desktop Chrome, installed mobile PWA, and fallback `fotos.html`.

## 15. Open Questions

- Should fotos sync original media in any opt-in mode, or remain metadata/thumb-first?
- What is the canonical replacement path for the current hand-rolled `one/index.html` writer?
- Which semantic model should be the default for hosted fotos.one, and how should model size be communicated?
- How should revocation of already-synced shared metadata be represented?
- What is the desired backup story for `one/` metadata and recovery factors?
- Which privacy-preserving product metrics, if any, should hosted fotos.one collect?

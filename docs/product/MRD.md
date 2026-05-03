# fotos Market Requirements Document

Status: Draft
Owner: fotos product and engineering
Last updated: 2026-04-29

## 1. Executive Summary

fotos is direct, unlimited, private device-to-device photo sharing with modern photo intelligence built in.

It gives people the power they expect from cloud photo products, including fast browsing, face grouping, semantic search, mobile capture, and family sharing, without handing their photo library to a platform. The promise is not "no internet exists." The promise is stronger: no cloud custody, no public-link default, no platform-owned album, no artificial storage ceiling imposed by someone else's photo service.

The product runs primarily as a browser/PWA client at fotos.one. It attaches to local folders, writes portable `one/` metadata beside the user's media, performs optional face and semantic analysis on device, and syncs metadata between trusted devices through ONE.core CHUM. A portable `fotos.html` viewer is the fallback and plugin surface for local `one/` folders when fotos.one is unavailable.

The broader opportunity is to make fotos the private photo network for the ONE ecosystem: a local-first gallery and direct trusted sharing layer. fotos id matters, but as an ecosystem side note: it can let users prove or recover identity using private photo-derived secrets without uploading recovery photos.

## 2. Product Thesis

People do not want a worse Google Photos. They want the magic without the surrender.

fotos should make this trade explicit:
- Your photos stay on devices and folders you control.
- Your people can receive photos directly, privately, and without public links.
- Your search, faces, and memories do not need to become somebody else's training data or cloud asset.
- Your archive remains portable because metadata travels beside the media.

The brave claim:

**All the power of cloud photos, without cloud custody.**

## 3. Market Problem

Mainstream photo tools optimize for cloud convenience. That leaves several unresolved customer problems:

- Private archives contain faces, locations, family events, children, documents, and personal history that users do not want mined or stored by an opaque service.
- Local folders are durable and understandable, but they lack modern search, face grouping, mobile ingest, and cross-device continuity.
- Exporting from cloud photo products often strips context, duplicates files, or leaves users dependent on proprietary app state.
- Families and small trusted groups need direct private sharing without creating public links, central cloud albums, or platform-controlled access rules.
- Cloud photo pricing turns memory into rented storage. Users should not have to meter family history against a provider quota.
- Identity recovery is often email, phone, or provider based; users want private recovery factors that they can control and reproduce.

## 4. Target Customers

### Privacy-First Family Archivist

Keeps years of family photos on a laptop, external disk, or NAS. Wants fast browsing, people grouping, and sharing with family members, but does not want originals uploaded to a cloud library.

Needs:
- Attach an existing folder without reorganizing it.
- See a complete timeline quickly.
- Find people and events privately.
- Share selected collections directly with trusted relatives.
- Preserve data in a format that remains readable later.

### Local-First Photographer or Creator

Uses file folders as the source of truth and may already have editing, backup, or archival workflows. Wants a gallery and search layer that respects the filesystem and avoids lock-in.

Needs:
- Portable sidecar metadata.
- Non-destructive ingest and re-scan.
- EXIF-aware sorting and filtering.
- Full-size review with zoom, pan, rotate, flip, export, and delete actions.
- A fallback viewer that travels with the archive.

### Mobile Capture User

Captures photos on a phone and wants them to enter the same private library without a full desktop sync client.

Needs:
- Installable PWA.
- Native share target from the phone gallery.
- Lightweight ingest on mobile.
- Desktop enrichment later, with results flowing back to mobile.

### Trusted Small Group

Shares photos with a few known people through the ONE/glue identity graph.

Needs:
- Share a whole gallery, collection, person, or cluster directly with named contacts.
- Accept incoming shared content explicitly.
- Avoid public URLs, central cloud albums, and broad server-side access.
- Keep sharing bounded by trust, device storage, and bandwidth instead of platform quotas.
- Know whether the remote identity is verified and online.

### Secondary: ONE Ecosystem User

Uses glue.one, vger, reaktor, or related apps and needs an identity and recovery surface.

Needs:
- Authenticate or recover with fotos id.
- Add passkeys for daily convenience.
- Keep photos and recovery factors local.
- Use one certified identity across ONE apps.

## 5. Jobs To Be Done

- When I open a photo folder, I want fotos to understand it without moving my originals, so I can keep my current archive structure.
- When I browse a large library, I want date, folder, tag, collection, person, and search views, so I can find things without manual albums.
- When I enable analysis, I want face and semantic results generated locally, so private content stays on my device.
- When I use my phone, I want to add photos quickly and let a stronger desktop device enrich them later.
- When I share photos, I want them to move directly to trusted people without public links, cloud custody, or artificial album limits.
- When fotos.one is unavailable, I want a local HTML viewer inside the archive, so the library remains useful.
- As a ONE ecosystem user, when I need identity recovery, I want private recovery factors I control, so I am not dependent only on a provider reset process.

## 6. Product Positioning

fotos is the private photo network for the open web and the ONE ecosystem.

Homepage-level positioning:

**All the power of cloud photos, without cloud custody.**

Supporting line:

Browse, search, recognize faces, and share directly with trusted people while your photos stay on devices and folders you control.

Positioning pillars:
- Direct private sharing. Photos should move between trusted devices and people, not through public links or platform-owned albums.
- No cloud custody. fotos should not require cloud storage or server-side media processing for core gallery use.
- Unlimited by design. fotos should not impose artificial storage or album limits; real limits are the user's devices, bandwidth, and trust choices.
- Search privately. Face and semantic intelligence should run on device and be user controlled.
- Carry your metadata. `one/` folders should preserve gallery state beside the archive.

## 7. Market Requirements

| ID | Requirement | Priority | Rationale |
| --- | --- | --- | --- |
| MRD-01 | Local-first folder attachment | Must | Users must be able to adopt fotos without importing all originals into a new proprietary store. |
| MRD-02 | Portable sidecar metadata | Must | The archive must remain browsable and recoverable outside the hosted app. |
| MRD-03 | Private on-device intelligence | Must | Face detection, clustering, and semantic search are core differentiators only if they avoid server analysis. |
| MRD-04 | Direct private device-to-device sharing | Must | Sharing is the product, not a side feature: users should be able to send photos to trusted people without public links, cloud albums, or platform custody. |
| MRD-05 | Mobile PWA capture and share target | Must | Mobile capture is the dominant source of new photos, even for local-first users. |
| MRD-06 | Trusted device sync | Must | Users expect continuity across desktop and mobile, but sync must honor the privacy model. |
| MRD-07 | fotos id and recovery | Should | Identity and recovery are not the core photo-sharing promise, but they strengthen fotos as part of the broader ONE ecosystem. |
| MRD-08 | Fallback viewer and plugin surface | Should | A portable local viewer reduces lock-in concerns and enables integration with vger/glue surfaces. |
| MRD-09 | Non-destructive management tools | Must | Delete, export, rescan, reanalyze, and collection workflows must be explicit and reversible where possible. |
| MRD-10 | Transparent trust and status | Must | Users need clear status for sync, identity, passkeys, recovery, sharing, and background analysis. |
| MRD-11 | No platform-imposed photo limits | Must | fotos should not monetize by becoming the storage choke point; capacity should be governed by user-owned storage and transport. |

## 8. Differentiation

fotos should win by refusing the bargain that made cloud photo products dominant: convenience in exchange for custody.

Key differentiators:
- Browser-based local folder access with `one/` sidecars.
- Optional on-device face analytics and semantic embeddings.
- ONE.core object model and CHUM sync for trusted device-to-device sharing and metadata movement.
- No public-link default for family sharing.
- No platform-owned central photo library.
- No provider storage quota standing between people and their memories.
- PWA share target for mobile ingest without installing a native app.
- Portable HTML fallback viewer for long-lived archives.
- Optional fotos id recovery based on private photos and passphrase/date factors.

## 9. fotos id Side Note

fotos id should be present in the product story, but it should not compete with the main promise. The main product is private photo sharing and private photo intelligence. fotos id is the useful ecosystem consequence: because fotos already deals with private photos, local keys, passkeys, and trusted devices, it can also become a natural recovery and proof surface for ONE identity.

What to say:
- fotos id lets users bind or recover a ONE identity from private photo-derived factors.
- Recovery photos stay local.
- Passkeys remain the convenient daily path.
- fotos id connects fotos to glue.one, vger, reaktor, and other ONE apps.

What not to do:
- Do not lead the homepage with identity.
- Do not make users understand fotos id before they understand photo sharing.
- Do not let recovery mechanics obscure the simple promise: your photos, shared directly, without cloud custody.

## 10. Distribution And Adoption

Primary distribution:
- fotos.one PWA for end users.
- Local development and self-hosted paths for power users.
- Portable `fotos.html` stored in `one/` folders.

Adoption loops:
- Attach an existing folder and immediately see a gallery.
- Enable face analytics and get people/grouping value.
- Install the PWA and share photos into the same library from mobile.
- Invite trusted contacts to receive a collection, cluster, or person directly.
- Set up fotos id recovery and use the same identity across ONE apps.

## 11. Success Metrics

Product metrics should be privacy preserving and avoid collection of user media, filenames, faces, embeddings, or contacts.

Activation:
- Percentage of new sessions that attach or restore a folder.
- Time from first visit to first visible gallery.
- Percentage of attached folders with `one/index.html` generated or parsed.

Engagement:
- Weekly sessions with search, face browse, semantic search, lightbox, or collections.
- Number of local libraries reopened through persisted folder handles.
- Share target imports completed after PWA installation.
- Direct private share attempts and completions, counted without recording media content or recipient identity.

Trust and reliability:
- Analysis completion rate by phase.
- Sync success rate between trusted devices.
- Direct share transfer success rate between trusted devices.
- Frequency of permission failures, stalled ingestion, and recovery flows.
- Percentage of users with passkey and recovery configured after identity setup.

Retention:
- Repeat use after first folder attach.
- Repeat mobile share target use.
- Repeat private sharing with trusted contacts.
- Number of libraries with fallback viewer materialized.

## 12. Constraints

- No photo uploads or cloud storage may be required for core gallery use.
- Server or headless infrastructure must not become a hidden media custodian.
- Original media should remain in user-controlled folders unless the user explicitly exports, imports, or shares through a known flow.
- "Unlimited" must mean no fotos-imposed storage quota or platform album ceiling; it cannot promise infinite device storage, infinite bandwidth, or permanent recipient availability.
- Metadata folder naming is `one/`, not `.one/`.
- The browser security model governs local folder access; permission recovery must be graceful.
- Face and semantic model downloads must be explicit or governed by clear settings.
- Mobile devices should not be required to perform heavy face analysis.

## 13. Assumptions To Validate

- Privacy-first users will accept browser folder permission flows if the product clearly explains local control through behavior, not marketing copy.
- Families will prefer direct named trusted sharing over public links when setup friction is low.
- Desktop enrichment plus mobile lightweight ingest is a better default than forcing every device to run heavy analysis.
- Portable `one/` metadata will reduce lock-in anxiety enough to drive adoption among local archive users.
- fotos id recovery can be explained simply enough for non-technical users.
- "Unlimited private sharing" is compelling enough to lead the product story, provided the UI explains real-world device and bandwidth limits honestly.

## 14. Out Of Scope For This MRD

- Full original photo cloud backup.
- Public social sharing network.
- Professional RAW editing workflow.
- Ad-based monetization.
- Server-side face recognition or semantic indexing.
- Migration tools for every third-party photo service.

## 15. Open Questions

- What is the minimum viable sharing experience for a non-technical family member?
- What exact media payloads define the first "direct photo sharing" release: originals, thumbnails, metadata, face crops, or selectable quality tiers?
- Should original photo sync be explicit per share, or should fotos remain metadata/thumb-first by default until recipients request originals?
- What recovery factors should the UI name and recommend so users can reproduce fotos id recovery reliably?
- How should `fotos.html` be packaged into `one/` folders as the canonical fallback viewer?
- What privacy-preserving telemetry, if any, is acceptable for hosted fotos.one?

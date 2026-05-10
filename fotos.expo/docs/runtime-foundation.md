# fotos.expo Runtime Foundation

This package is meant to be a `vger.expo` sibling, not a detached Expo demo.

The rule for this app is:

1. `refinio one` remains the runtime spine.
2. `vger.expo` remains the initialization template.
3. fotos features land on top of that spine instead of replacing it.

## Source of truth

- `../vger/packages/vger.cube/one.md`
- `./ios-ui/Model.ts`
- `../vger/packages/vger.expo/ios-ui/Model.ts`

Those files define the shape we should preserve:

- `MultiUser` boot and per-user storage
- recipe and reverse-map registration
- settings, secrets, and devices plans
- shared module initialization
- mDNS-backed local discovery
- handshake-backed verified peer collection
- instance and trust surfaces for user/device management

## What is already wired

The current scaffold keeps the same basic init structure as `vger.expo`:

- `app/_layout.tsx` creates a single `Model` and logs in through `MultiUser`
- `ios-ui/Model.ts` registers fotos recipes alongside the shared ONE, glue, trust, cube, and device recipes
- `ios-ui/Model.ts` now boots through the `vger.core` `mobile-library` initializer instead of the full `full-vger` graph
- fotos has its own settings section in `ios-ui/fotos-settings.ts`
- discovery still flows through `iOSMDNSDiscoveryAdapter` and `DiscoveryCollectionAdapter`
- the app surfaces device and instance state instead of hiding the runtime

## What the requested backbone means here

### Shared service contract

`fotos.expo` should align with the shared fotos service contract described in
`../../docs/fotos-service-contract.md`.

Its persistence shape should also align with the media model described in
`../../docs/fotos-media-model.md`.

That means the native app should eventually present the same fotos runtime
surface that `vger.headless` already serves:

- `fotos:status`
- `fotos:ingest`
- `fotos:pause`
- `fotos:resume`
- `fotos:browse`
- `fotos:folders`

The media backend can stay native and iOS-specific. The contract we want to
share is the fotos behavior layer above it.

### Persistent media model

For Expo this means:

- `contentHash` stays the canonical media identity
- Photos / `PHAsset` ids are locators, not identities
- thumbnails, previews, face crops, and edits should be tracked as separate
  known variants when their bytes differ
- local reachability should be stored separately from shared fotos metadata

That lets on-device analysis stay reusable when the same image appears later on
another device, in a browser library, or through headless sync.

### mDNS

Reachability and local-network discovery. This is how nearby peers first appear.

### QUICVC

The transport claim we expect to see on native peers. Discovery can advertise it, but the real value is using it after trust and handshake succeed.

### CHUM

The sync mechanism. fotos should not invent a separate replication story when CHUM already provides the object-exchange backbone.

### User management

This means more than a login form. We need:

- owner identity
- local instance identity
- my devices
- contact devices
- trust levels
- verified peers after handshake

### Runs

Runs should sit on top of the initialized runtime, not alongside it. The first obvious run families are:

- library ingest
- analysis and enrichment
- manifest sync
- trusted sharing

## Next implementation steps

1. Keep typecheck green while the scaffold is still thin.
2. Add fotos-specific CHUM object filters and import policy.
3. Turn planned runs into explicit run descriptors and execution hooks that match the shared fotos service contract.
4. Connect gallery ingest to real mobile sources on top of the existing identity, variant, and locator model.

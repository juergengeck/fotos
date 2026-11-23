# Fotos Expo runtime

Use `corepack pnpm@9.15.0` for this standalone Expo install. pnpm 10 resolves
unpublished internal peers differently from the ONE workspace's pinned version.

`corepack pnpm@9.15.0 run vendor:setup` packs the source packages listed in
`.vendorrc.json` into this application's own `vendor/`, then installs the complete graph. Tarball filenames include their content digest
so pnpm cannot silently reuse metadata from a different local build at the same
version.
Build the listed owning packages in `../../one` before packing; `vendor:pack`
does not build shared packages. `transitivePackages` contains internal package
metadata dependencies that are packed without adding new app roots.

The runtime links `../fotos.core` and the ONE-owned provenance and native device
UI sources directly. ONE runtime packages come from one coordinated set of
owner-built tarballs; never point `vendor` at another application's cache or
replace individual runtime packages with another generation.

Fotos initializes identity, settings/secrets/devices, signed Assembly publication,
personal trust, connections/discovery and instances. Chat protocol plans remain
required by connection pairing and group sync. The app does not initialize AI,
LLM, memory, IMAP or BLE features.

Checks:

```sh
corepack pnpm@9.15.0 typecheck
corepack pnpm@9.15.0 test:auth
corepack pnpm@9.15.0 exec vitest run ios-ui/fotos-runtime-modules.test.ts ios-ui/fotos-runtime-recipes.test.ts ios-ui/services/FotosMediaLibrarySync.test.ts
corepack pnpm@9.15.0 exec expo export --platform ios --output-dir /tmp/fotos-expo-export
```

Native dependency changes require a fresh Expo prebuild and CocoaPods install
before an Xcode build. An existing Pods directory can still contain removed
inference packages.

React Native 0.81 codegen requires the pinned `@dr.pogodin/react-native-fs`
version. The newer native spec uses `ArrayBuffer` fields that this codegen
cannot parse.

The local `FotosPhotoKit` module provides Photo Library intake on iOS. Native
code streams originals to temporary files, hashes the encoded content, and
supplies bounded JPEG previews. Reference intake transfers the preview to ONE
and keeps a device-local Photos identifier for original access. The library
screen offers a separate download action for iCloud-only assets.

Imported user albums store content hashes of synced members. Full Photos access
allows membership reconciliation. Limited access preserves members and albums
outside the visible selection.

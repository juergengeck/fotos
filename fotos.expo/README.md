# Fotos Expo runtime

Fotos uses Expo SDK 57, React Native 0.86, React 19.2, and TypeScript 6.

Use `corepack pnpm@9.15.0` for this standalone Expo install. pnpm 10 resolves
unpublished internal peers differently from the ONE workspace's pinned version.

`corepack pnpm@9.15.0 run vendor:setup` packs the source packages listed in
`.vendorrc.json` into this application's own `vendor/`, then installs the complete graph. Tarball filenames include their content digest
so pnpm cannot silently reuse metadata from a different local build at the same
version.
Build the listed owning packages in `../../one` before packing; `vendor:pack`
does not build shared packages. `transitivePackages` contains internal package
metadata dependencies that are packed without adding new app roots.
To refresh a package at a time, use `pnpm vendor:pack --packages=@refinio/media.expo`,
then install and run `pnpm verify:vendor-install`. The `start`, `ios`, and
`android` scripts verify the local archives and installed files before launch.

The native device UI still uses the ONE workspace source. `fotos.core`,
provenance, and the other ONE runtime packages use one coordinated set of
owner-built archives. Keep the archive cache local to this app and build the
runtime packages from the same platform generation.

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

The shared `@refinio/media.expo` package provides Photo Library intake on iOS.
Native code streams originals to temporary files, hashes the encoded content,
and supplies bounded JPEG previews. Reference intake transfers the preview to
ONE and keeps a device-local Photos identifier for original access. The library
screen offers a separate download action for iCloud-only assets. The package
also autolinks its MediaStore module on Android.

Imported user albums store content hashes of synced members. Full Photos access
allows membership reconciliation. Limited access preserves members and albums
outside the visible selection.

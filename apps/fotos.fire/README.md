# Fotos for Fire TV

A dedicated native React Native TV app for fotos.one. It has its own launcher entry,
encrypted local ONE instance, native photo grid, fullscreen images, remote navigation,
and slideshow. Its QR invitation pairs a trusted Fotos device; pairing alone does
not grant access to a photo library. The sending device must share a gallery with
this TV.

The app uses Expo 54.0.34 and the selected React Native TV 0.81.5-2 fork.
Both native apps participate in the owning Fotos pnpm/Turbo workspace. They share
`@refinio/fotos.native` bootstrap/bundler exports while each app installs its own
explicit native/runtime providers. Foreign libraries use Sources-managed public
packages. No vendor setup, source aliases or hoisting are part of this workflow.

## Build and install

Prepare the declared producer outputs at their owners, following the staged root
AGENTS.md workflow. From the Fotos root, use its declared pnpm version:

```bash
pnpm install --frozen-lockfile
pnpm --filter @refinio/fotos.fire typecheck
pnpm --filter @refinio/fotos.fire test
pnpm --filter @refinio/fotos.fire build
```

`build` is the actual Expo/Metro Android export, including Hermes compilation. It
does not build/sign an APK, provision a device or deploy. APK commands below need
Node 20.19.4+, Java 17 and the Android SDK and remain separately unqualified.
Historical missing-vendor-archive checks stay deferred in
[Fotos issue 2](https://github.com/juergengeck/fotos/issues/2). The public-provider
migration does not reconstruct or qualify that historical baseline. The original
console-timing patch is retained; current installed vger.core already implements
its native-safe behavior. See `patches/README.md`.

From this app directory, only when performing separately authorized native work:

```bash
pnpm build:apk
pnpm run deploy 192.168.178.23:5555
```

Enable ADB debugging on the Fire TV and approve this computer on its screen first.
The deployment script defaults to `192.168.178.23:5555`; set `FOTOS_FIRE_DEVICE` or
pass a device address to use another stick. The Android package is `one.fotos.fire`.

`build:apk` updates the generated native project and builds a standalone release
APK with bundled JavaScript for `armeabi-v7a`, the ABI supported by the Fire TV Stick
4K (2nd Gen). It runs without a development server. The APK uses Expo's local debug
signing key for installation on development devices. It is not an Appstore build.

Output: `android/app/build/outputs/apk/release/app-release.apk`.

## Pairing

Open the QR link on your phone. In Fotos, open Settings → Devices → Use an
invitation, paste the complete scanned URL (including its fragment), and choose
Pair this device. Then share a gallery with the TV from the sending Fotos device.
The current browser requires these manual steps for a contact invitation.

## Remote

- D-pad moves focus in the gallery; Select opens a photo.
- Left and Right browse fullscreen images.
- Select or Play/Pause controls an eight-second slideshow.
- Back closes the viewer or pairing dialog.

Videos currently show an explicit playback-unavailable state. Only verified,
active Fotos shares are projected into the gallery; desktop file paths are never
used as TV media URLs. Downloaded media is cached in the app's private storage.

## Checks

```bash
pnpm typecheck
pnpm test
```

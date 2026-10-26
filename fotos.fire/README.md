# Fotos for Fire TV

A dedicated native React Native TV app for fotos.one. It has its own launcher entry,
encrypted local ONE instance, native photo grid, fullscreen images, remote navigation,
and slideshow. Its QR invitation pairs a trusted Fotos device; pairing alone does
not grant access to a photo library. The sending device must share a gallery with
this TV.

The app uses Expo 54, the matching React Native TV fork, and the same vendored ONE
package generation as `../fotos.expo`. Shared platform sources belong to
`../../one/packages`; `one-experimental` is not a dependency. Metro resolution is
shared with the phone app while each target uses its own React Native installation.

## Build and install

Requires Node 20.19.4+, pnpm, Java 17, the Android SDK, and the prepared
`fotos.expo/vendor` archives used by the current mobile runtime. Dependencies
reference that sibling directory directly; no TV-specific vendor copy is needed.
From this folder:

```bash
pnpm install --ignore-workspace
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
node --test src/ui/navigation.test.mjs
```

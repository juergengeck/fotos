# fotos.html

Portable fallback viewer for `one/` photo folders.

Intent:

- `fotos.browser` is the primary PWA and sync client.
- `fotos.html` is the HTML app we should be able to store alongside photo metadata in `one/` folders.
- `fotos.html` is also the media-view plugin surface for `vger.html` and `glue.browser`.
- That stored HTML should remain browsable when `fotos.browser` or fotos.one is unavailable.

Current state:

- The intended role is correct, but the repo is not fully aligned yet.
- `fotos.browser/browser-ui/src/lib/browserIngest.ts` still writes a hand-rolled `one/index.html` listing.
- `fotos.html` still has a server-backed access layer from the older app split.

So `fotos.html` should be treated as the canonical fallback target and plugin entrypoint, and the current generated `one/index.html` is only a temporary implementation until those paths are unified.

# fotos

Photo apps and shared packages for the fotos stack.

Product docs:

- [Market requirements](docs/product/MRD.md)
- [Product requirements](docs/product/PRD.md)

Packages:

- `fotos.browser` - browser/PWA client for fotos.one
- `fotos.core` - shared gallery, face, and recipe logic
- `fotos.html` - portable HTML fallback app and media-view plugin for `vger.html` / `glue.browser`, meant to live in `one/` folders when `fotos.browser` is unavailable
- `fotos.ui` - shared React hooks and UI helpers

Metadata folders are named `one/` throughout this repo. We do not use `.one/`.

This checkout is designed to live beside `../vger` and consume VGER packages from that sibling repo.

# fotos

Photo apps and shared packages for the fotos stack.

Packages:

- `fotos.browser` - browser/PWA client for fotos.one
- `fotos.core` - shared gallery, face, and recipe logic
- `fotos.html` - portable HTML fallback app and media-view plugin for `vger.html` / `glue.browser`, meant to live in `one/` folders when `fotos.browser` is unavailable
- `fotos.ui` - shared React hooks and UI helpers

This checkout is designed to live beside `../vger` and consume VGER packages from that sibling repo.

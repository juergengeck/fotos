# fotos

Photo apps and shared packages for the fotos stack.

Product docs:

- [Market requirements](docs/product/MRD.md)
- [Product requirements](docs/product/PRD.md)

Packages:

- `fotos.browser` - browser/PWA client for fotos.one
- `fotos.core` - shared gallery, face, and recipe logic
- `fotos.headless` - split headless deployment, Fotos skills, and semantic batch tooling for `spark` + `schweiz`
- `fotos.html` - portable HTML fallback app and media-view plugin for `vger.html` / `glue.browser`, meant to live in `one/` folders when `fotos.browser` is unavailable
- `fotos.ui` - shared React hooks and UI helpers

Metadata folders are named `one/` throughout this repo. We do not use `.one/`.

This checkout is designed to live beside `../one` and `../vger`. Shared ONE platform
packages come from `../one/packages`; shared capabilities and platform fixes are
developed there. Packages still owned by VGER come from `../vger`.

`../one-experimental` remains the base for Flexibel only. Fotos does not use it as a
dependency, build, test, or deployment source.

Install web clients and shared Fotos packages from this repository. Build the
required shared ONE packages in their owning `../one` workspace first, then:

```bash
ONNXRUNTIME_NODE_INSTALL=skip corepack pnpm install
corepack pnpm --filter @refinio/fotos.core build
corepack pnpm --filter @one/fotos.browser.ui build
corepack pnpm --filter @one/fotos.browser.ui test
```

After the initial lockfile is generated, use `pnpm install --frozen-lockfile`.
Cross-repository dependencies use ordinary `file:` installations. Reinstall after
rebuilding a changed producer so the installed files reflect its current output.
The root manages the six local web/shared/deployment packages with pnpm and Turbo;
it never includes packages from another Git repository. Library consumers install
the internal peers declared by `@refinio/fotos.core` explicitly.

Expo retains its separate vendored installation (`fotos.expo/.vendorrc.json`).
The `fotos.browser` wrapper is not a workspace member because it still declares
the legacy `one.fotos` dependency; use `@one/fotos.browser.ui` for web development.

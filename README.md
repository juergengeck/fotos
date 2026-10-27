# fotos

Photo apps and shared packages for the fotos stack.

Product docs:

- [Market requirements](docs/product/MRD.md)
- [Product requirements](docs/product/PRD.md)

Layout:

- `apps/fotos.browser` - browser/PWA client for fotos.one
- `apps/fotos.expo` - native phone client
- `apps/fotos.fire` - native Fire TV client
- `packages/fotos.core` - shared gallery, face, and recipe logic
- `packages/fotos.headless` - split headless deployment, Fotos skills, and semantic batch tooling for `spark` + `schweiz`
- `apps/fotos.html` - portable HTML fallback app and media-view plugin for `vger.html` / `glue.browser`, meant to live in `one/` folders when `fotos.browser` is unavailable
- `packages/fotos.ui` - shared React hooks and UI helpers

Metadata folders are named `one/` throughout this repo. We do not use `.one/`.

Sources selects the ONE and VGER owners under `sources/one` and `sources/vger`.
Develop shared capabilities in their owning repository, then rebuild and refresh
the native file installation here. See AGENTS.md for the staged bootstrap.

`../one-experimental` remains the base for Flexibel only. Fotos does not use it as a
dependency, build, test, or deployment source.

Install web clients and shared Fotos packages from this repository. Build the
required shared ONE packages in their selected owning workspace first, then:

```bash
ONNXRUNTIME_NODE_INSTALL=skip corepack pnpm install
corepack pnpm --filter @refinio/fotos.core build
corepack pnpm --filter @one/fotos.browser.ui build
corepack pnpm --filter @one/fotos.browser.ui test
```

After the initial lockfile is generated, use `pnpm install --frozen-lockfile`.
Cross-repository dependencies use ordinary `file:` installations. Reinstall after
rebuilding a changed producer so the installed files reflect its current output.
The root manages its local web/native/shared/deployment packages with pnpm and Turbo;
it never includes packages from another Git repository. Library consumers install
the internal peers declared by `@refinio/fotos.core` explicitly.

Both native apps now use the owning root workspace and lock with Sources-managed
public providers. Direct external selections are preserved; conflicting transitive
entries follow the user-approved existing-root priority. See AGENTS.md for native
preparation and the precise qualification limits. The obsolete browser wrapper
remains excluded because its `one.fotos` dependency no longer exists.

`packages/fotos.gallery` supplies reusable source React components. Headless holds
deployment tooling and skills rather than a standalone server. Its network batch
checks remain behind the explicit `test:batch` command. The browser development
server retains scan, local-photo serving and proxy routes. Two unused catalog/query
routes targeting the absent `one.fotos` producer were removed; no current UI, test
or documentation called those routes.

Historical Fire TV missing-archive checks remain deferred in
[Fotos issue 2](https://github.com/juergengeck/fotos/issues/2). No vendor baseline
was regenerated or substituted. Current public-provider metadata and workspace
migration do not qualify those archives, physical devices, signing or deployment.
The original native-console patch is retained; its behavioral requirement must
also hold in the current installed owning vger.core output.

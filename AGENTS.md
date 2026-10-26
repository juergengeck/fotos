# Fotos workspace

## Shared platform ownership

- Use `sources/one` as the shared ONE platform base for Fotos. Develop shared capabilities
  and fix platform defects in the owning package under `sources/one/packages`.
- `../one-experimental` remains the base for Flexibel only. Do not source Fotos
  dependencies, builds, tests, or deployment artifacts from that checkout, or make
  changes there for Fotos.
- Keep packages that still belong to `sources/vger` there until their ownership moves;
  resolve packages already owned by ONE directly from `sources/one/packages`.
- Follow `sources/one/AGENTS.md` when changing shared packages. Keep the current runtime
  package generation coherent until its coordinated migration; do not introduce
  compatibility layers or a partial old/new runtime graph.

## Repository-local skills and refactoring

- When the same skill name is available from multiple locations, always use the repository-local skill under `$REPO_ROOT/.agents/skills/`. Repository-local skills take precedence over user-global skills. Do not load or apply the corresponding skill from `$HOME/.agents/skills/` when a repository-local version exists.
- Consider the repository's current publication state and backwards-compatibility requirements recorded in `.agents/refactor-policy.md` in all interactions.

## Sources-managed preparation and checks

Foreign package paths use `sources/one` and `sources/vger`. Sources selects the
checkouts with `.sources.local.conf` in development and `.sources.lock` for Git
release inputs. These packages remain outside this repository's pnpm workspace.
Use Sources 0.3.1 or later for transitive task-hash propagation.

The first Sources task requires the child tooling and selected native dependency
closure to be installed. On a clean checkout, bootstrap those before invoking it:

```sh
sources dev
(cd sources/one && pnpm --filter one-experimental --filter '@refinio/one.core...' --filter '@refinio/one.models...' --filter '@refinio/meaning.core...' --filter '@refinio/trie.core...' --filter '@refinio/trust.core...' --filter '@refinio/provenance.core...' --filter '@refinio/sync.core...' install --frozen-lockfile)
sources task @refinio/one.core:build @refinio/one.models:build @refinio/meaning.core:build @refinio/trie.core:build @refinio/trust.core:build @refinio/provenance.core:build @refinio/sync.core:build
pnpm install --frozen-lockfile
pnpm --filter @refinio/fotos.core build
pnpm --filter @refinio/fotos.core typecheck
pnpm --filter @refinio/fotos.core test
```

For the complete app graph, prepare the remaining ONE and VGER producers after
Fotos.core, then refresh this installation before `pnpm build`, `pnpm typecheck`
and `pnpm test`. Root scripts launch Sources Turbo. Consumer tasks declare exact
foreign hashes; artifact preparation and native installation refresh stay
explicit. `pnpm sources:prepare` requests all direct foreign owning tasks and
assumes their own prerequisite installations are already prepared.

Do not add automatic nested foreign preparation to child build tasks: ONE's API
consumes Fotos.core, and a nested `sources task` chain must not reenter a held
Sources project lock. Use sequential stages outside `sources run`/`sources task`.
For clean release checkouts use the Sources selected-closure bootstrap guidance;
activation and installation are separate and immediate-owner Git pins apply.

Expo retains its separate vendored installation and frozen lock as an unqualified
migration baseline, not an approved package-policy exception. The legacy
`fotos.browser` wrapper remains excluded because `one.fotos` no longer exists;
use `@one/fotos.browser.ui`. Existing broader migration failures remain visible.

## Local layout

Browser applications live under `apps/`; shared libraries and private deployment
tooling live under `packages/`. Workspace membership is explicit: only the nested
`apps/fotos.browser/browser-ui` is active, while its legacy wrapper remains excluded.
Preserve the separately vendored Expo installation. Do not introduce checkout source
aliases or consumer-owned recipe registries; consume the owning public package entries.

Fotos.core now imports Provenance and shared Sync rules through their public
ONE entries. Prepare those two owners alongside the original five foundation
packages before refreshing Fotos.core or a consumer in the ONE/Fotos repository
cycle. The selected seven-package foundation graph remains directed toward
ONE.core and Trust; it does not require a reverse Fotos app build. New
Git-pinned bootstrap and cache qualification must cover this expanded closure.

Fire TV checks are explicitly deferred in [Fotos issue 2](https://github.com/juergengeck/fotos/issues/2):
the new target's frozen pnpm 10 installation requires the exact ignored archives
in `fotos.expo/vendor`, which are unavailable. Preserve the declared vendor and
patch contracts; do not substitute same-version archives or regenerate a baseline.
Its existing standalone layout/lock is an unqualified migration gap pending those
inputs, not an approved workspace-policy exception. Native install, typechecking,
APK and physical Fire TV qualification remain outstanding; the existing navigation
tests alone do not establish those results.

## Remaining Expo and Fire TV package migration

The excluded Expo target has 97 unmanaged vendor references, and Fire TV has 96.
Both still live outside `apps/` and the repository workspace, with separate locks;
neither target has completed the shared metadata, layout or workspace policy.
Preserving the existing archives and patches does not waive those requirements.
Fire TV issue 2 defers its unavailable native checks only.

Remaining work is to establish the platform baseline with the exact required
archives, then move the targets under `apps/`, reconcile their installation with
the owning root workspace/lock and Turbo, replace unmanaged foreign vendor
references with Sources-managed owner packages, and verify Metro resolution
through public exports and concrete providers. Preserve selected external
versions, native patches and platform contracts throughout. Expo is also missing
96 required vendor archives in this checkout; its native install/types/build and
physical-device checks are unqualified. Do not regenerate or substitute archives
to claim either baseline or the policy migration passes.

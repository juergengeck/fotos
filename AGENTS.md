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

The native applications participate in the same owning workspace and root lock.
Use the root's declared pnpm version and frozen installation. Native external
versions remain pinned to their original app lock selections; at conflicting
transitive snapshot keys, the user-approved policy retains the pre-existing root
selection. This is not permission to upgrade direct dependencies.

## Local layout

Applications live under `apps/`; shared libraries and private deployment
tooling live under `packages/`. Workspace membership is explicit: native apps `apps/fotos.expo` and
`apps/fotos.fire` join the shared packages and nested browser UI; the obsolete
browser wrapper remains excluded because `one.fotos` no longer exists. Do not introduce checkout source
aliases or consumer-owned recipe registries; consume the owning public package entries.

Fotos.core now imports Provenance and shared Sync rules through their public
ONE entries. Prepare those two owners alongside the original five foundation
packages before refreshing Fotos.core or a consumer in the ONE/Fotos repository
cycle. The selected seven-package foundation graph remains directed toward
ONE.core and Trust; it does not require a reverse Fotos app build. New
Git-pinned bootstrap and cache qualification must cover this expanded closure.

## Native applications and qualification

Temporary [ONE#13](https://github.com/juergengeck/one/issues/13) exclusion:
Expo and Fire do not use `@refinio/cube.time`, so their dependencies and the
workspace's Sources allowlist, preparation and task hashes omit it. Standalone
CubeTime remains an unqualified target owned by ONE. The required shared Trie
recipes and `@refinio/cube.core` providers remain intact; restore CubeTime only
for an actual consumer after its owning type/build failure is resolved.

Both native apps use ordinary owning-package providers.
`packages/fotos.native` supplies their shared source bootstrap and Metro/Babel
configuration through public workspace exports; app trees do not import each
other's bootstrap source. Foreign libraries are
copied from Sources-managed directories; Fotos.core uses `workspace:*`. UDP's
owning repository is selected at `sources/udp`, and its public package lives at
`sources/udp/packages/react-native-udp-ios`. Prepare outputs at their owners,
then refresh the normal root installation. Do not recursively prepare an ancestor
project, regenerate vendor archives, or emit held producers during consumer checks.

Expo 54's `expo/metro-config` supports this isolated pnpm workspace. Metro resolves
installed public exports without checkout aliases, extra foreign `node_modules`,
hoisting rules, source fallbacks or Node-only stubs. NativeWind scans the installed
public UI package. SDK 54 autolinking module resolution is enabled for both native
apps so bundled native modules follow each app's actual declared native providers. Check native module resolution and app-specific React Native
selection before claiming a bundle or device result. The user explicitly approved the existing react-native-tvos 0.81.5-2 fork for
both native apps to avoid mixed phone/TV native declarations. Expo remains
54.0.34 and other direct selections remain unchanged. Only Fire enables TV mode.

The app `build` commands bundle JavaScript with Expo/Metro and do not sign or deploy.
`typecheck` remains the strict native app program, and `test` includes the existing
native tests. Run them directly during a producer-output hold; the full Turbo graph
can rebuild local libraries and must wait until their consumer window allows it.

The missing-archive checks in [Fotos issue 2](https://github.com/juergengeck/fotos/issues/2)
remain explicitly deferred. Migration to current public owner providers does not
reconstruct or qualify the unavailable historical Fire vendor baseline. No missing
archive is replaced or regenerated. This deferral does not cover metadata, layout,
workspace, declared dependencies, or newly reachable native check failures. APK,
physical device and live sharing qualification must be reported separately.

The original `apps/fotos.fire/patches/vger.core-native-console.patch` is retained
byte-for-byte. Its native-console contract requires Date.now/console.log timing
instead of console.time/timeEnd in CoreModule initialization. Current ONE's public
vger.core output already carries that behavior; validate the installed output
before retiring an obsolete application of the archival patch. Never edit or
patch the owning emitted files in a consumer.

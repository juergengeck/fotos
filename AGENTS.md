# Fotos workspace

## Shared platform ownership

- Use `../one` as the shared ONE platform base for Fotos. Develop shared capabilities
  and fix platform defects in the owning package under `../one/packages`.
- `../one-experimental` remains the base for Flexibel only. Do not source Fotos
  dependencies, builds, tests, or deployment artifacts from that checkout, or make
  changes there for Fotos.
- Keep packages that still belong to `../vger` there until their ownership moves;
  resolve packages already owned by ONE directly from `../one/packages`.
- Follow `../one/AGENTS.md` when changing shared packages. Keep the current runtime
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
(cd sources/one && pnpm --filter one-experimental --filter '@refinio/one.core...' --filter '@refinio/one.models...' --filter '@refinio/meaning.core...' --filter '@refinio/trie.core...' --filter '@refinio/trust.core...' install --frozen-lockfile)
sources task @refinio/one.core:build @refinio/one.models:build @refinio/meaning.core:build @refinio/trie.core:build @refinio/trust.core:build
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

Expo retains its separate vendored installation and frozen lock. The legacy
`fotos.browser` wrapper remains excluded because `one.fotos` no longer exists;
use `@one/fotos.browser.ui`. Existing broader migration failures remain visible.

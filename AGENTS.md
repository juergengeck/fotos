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

## Workspace preparation and checks

- Run `corepack pnpm install` at this repository root after manually building required shared packages in `../one`. Use `--frozen-lockfile` once the owning lock is available. Cross-repository dependencies are ordinary `file:` installations; reinstall after changing producer output.
- Run `corepack pnpm build`, `corepack pnpm typecheck`, and `corepack pnpm test` for the local Turbo graph, or select the owning package with `--filter`. Source-only `fotos.ui` has checks and no transpilation step.
- Build caching remains disabled until Sources includes upstream package hashes in task inputs. Copied `file:` dependencies can change without changing local source or lockfiles; refresh installed producers before running the uncached builds.
- Expo retains its separate vendored installation and frozen lock. The legacy `fotos.browser` wrapper remains excluded because `one.fotos` no longer exists; use `@one/fotos.browser.ui`.
- When package-boundary-guard is installed locally, apply it and its shared package-rules.md artifact when creating packages or changing internal package relationships.

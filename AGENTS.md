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

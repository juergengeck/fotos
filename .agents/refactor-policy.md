# Refactoring policy

- Preserve existing public APIs, supported behavior, and persisted data formats.
- Internal package and layout changes may update all affected workspace consumers together, preserving runtime behavior.
- Any required public break needs separate approval, a migration plan, and clear release notes for downstream consumers.

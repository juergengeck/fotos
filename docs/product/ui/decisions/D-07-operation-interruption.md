# D-07: Operation interruption semantics

Status: Resolved for v1
Date: 2026-08-02
Owners: fotos product and engineering

## Decision

Do not expose pause, cancel, or resume controls for ingest or analysis in v1.
Those controls become eligible only after the engine owns an explicit operation
token and a tested persistence boundary for the affected phase.

The UI may keep browsing available during a rescan or analysis pass and must show
the current phase honestly. Closing the app remains an interruption, not a promised
cancel or pause operation.

## Evidence

- Directory ingest and rescan do not accept an `AbortSignal`. They scan, process,
  and write incrementally before returning.
- Face and semantic worker clients can terminate their worker, but termination does
  not reject outstanding requests. Terminating mid-pass can therefore leave callers
  waiting on unresolved promises.
- Reanalysis clears persisted results before rebuilding them. Cancelling between
  those steps would require an explicit resumable checkpoint or transactional restore.
- Current progress state has no operation identity, terminal cancellation state, or
  durable resume cursor.

## Required engine work before controls are added

1. Give each run an operation identity and lifecycle state.
2. Propagate an abort signal through scan, processing, metadata writes, and worker calls.
3. Reject every outstanding worker request when a worker terminates.
4. Define the last safe commit boundary for each phase and make restart behavior idempotent.
5. Persist or deliberately discard a resume cursor, then test reload and folder-switch cases.
6. Expose terminal failed/cancelled/completed state independently from transient progress.

## Consequence

The trustworthy-operations implementation removes deceptive progress and keeps
background work visible without adding controls whose data-safety semantics do not
yet exist.

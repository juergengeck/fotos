# fotos UI Delivery Plan

Status: Proposed
Owner: fotos product and engineering
Last updated: 2026-08-02
Related: [UI audit](../ui.prd.md), [PRD](../PRD.md), [MRD](../MRD.md)

## Purpose

This directory converts the UI audit into bounded, decisioned delivery work. The
[audit](../ui.prd.md) remains the evidence source: current flows, observed defects,
code anchors, and directional proposals. Each epic here owns one product outcome,
its scope, dependencies, acceptance criteria, and validation.

These documents do not authorize silent product decisions. Open decision gates must
be resolved and recorded before an affected epic moves from proposed to committed.

## Product Principles

All UI work must reinforce the existing product strategy:

1. Deliver value before configuration: reach the first useful gallery quickly.
2. Never imply cloud custody, measured progress, revocation, or deletion semantics
   that the system cannot guarantee.
3. Direct private sharing is a core product job; identity mechanics are supporting
   infrastructure and should not dominate photo tasks.
4. Preserve local folders and originals unless the user explicitly chooses an action
   whose copy names the effect.
5. Accessibility is part of component structure and completion, not a cleanup phase.

## Decision Gates

| ID | Decision | Blocks | Status |
|---|---|---|---|
| D-01 | Is headless `Connect to server` an end-user path or an Advanced/development affordance? | App shell and first run | Open |
| D-02 | Does mobile use a simplified shell, or the desktop information architecture adapted to a sheet? | App shell | Open |
| D-03 | Recipient removal publishes a newer revocation version of the sharing certificate, removes derived access to the affected roots, and stops future synchronization. It does not remotely delete content already synchronized or saved by the recipient. | — | [Decided](./decisions/D-03-sharing-revocation.md) |
| D-04 | Is Breadcrumb History a user-facing “Saved places” feature or an Advanced/platform tool? | App shell | Open |
| D-05 | Is portable HTML export a v1 commitment? If yes, what artifact does it produce? | Trustworthy operations | Open |
| D-06 | Is AI Audit allowed in production builds? | App shell | Open |
| D-07 | Which ingest and analysis phases have safe pause, cancel, and resume semantics? | Trustworthy operations | Discovery required |

Decision records should state the chosen behavior, rationale, owner, date, and affected
acceptance criteria. Do not remove rejected alternatives from history.

## Delivery Order

| Order | Epic | Why now |
|---|---|---|
| 1 | [Trustworthy operations](./trustworthy-operations.epic.md) | Removes false state, dead controls, ambiguous destruction, and fundamental access barriers without waiting for the shell redesign. |
| 2 | [Unified selection](./selection.epic.md) | Establishes the interaction contract used by collections, people management, sharing, export, and deletion. |
| 3 | [App shell and navigation](./app-shell.epic.md) | Rehouses stable actions after selection is authoritative, avoiding two migrations. |
| 4 | [Explicit sharing](./sharing.epic.md) | Builds reviewable access changes on the new action and navigation surfaces. |

Discovery for later findings may proceed, but UX-15–16 and UX-20–25 stay outside
these epics unless their scope is explicitly amended.

## Cross-Cutting Release Gates

Every epic must satisfy these constraints for the components it changes:

- Complete keyboard operation with logical focus movement and focus restoration.
- No nested interactive controls or click-only actions.
- Body text is at least 12px and meets 4.5:1 contrast; meaningful non-text UI meets
  3:1 where WCAG requires it.
- Pointer targets are at least 44×44 CSS pixels unless an accepted exception is
  documented for an equivalent inline target.
- Loading, progress, success, and failure states are truthful and announced to
  assistive technology without producing repetitive noise.
- Mobile portrait, mobile landscape, and desktop behavior are specified and tested.
- Existing user-owned folders and metadata remain compatible or receive an explicit
  migration plan.

## Privacy-Preserving Success Measures

Measurements must not record media, filenames, faces, embeddings, search text, or
recipient identity.

- Time from folder choice to first visible photo.
- Completion and cancellation rate by ingest/analysis phase.
- Selection task completion for photo-only, people-only, and supported combined jobs.
- Share review-to-commit rate and transfer success rate.
- Frequency of permission, progress, focus, and destructive-action failures.
- Keyboard-only completion of the primary scenario in each epic.

Each epic may add a small number of outcome-specific measures. Event names and data
retention require a separate telemetry review; the metrics here do not themselves
authorize instrumentation.

## Definition of Ready

An epic is ready for implementation when:

- Its blocking decisions are resolved.
- The affected state owners and persistence boundaries are known.
- The interaction contract covers desktop, touch, keyboard, and assistive technology.
- Acceptance criteria are testable without subjective visual judgment alone.
- Engineering has identified migrations and interruption/restart risks.

## Definition of Done

An epic is done when its acceptance criteria and cross-cutting release gates pass,
automated checks cover state transitions and semantics where practical, and a manual
task-based pass succeeds on desktop and mobile-sized surfaces.

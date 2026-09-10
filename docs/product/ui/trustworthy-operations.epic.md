# Epic: Trustworthy Operations

Status: In progress
Owner: fotos product and engineering
Last updated: 2026-08-03
Evidence: [UX-04–08, UX-12–13](../ui.prd.md#4-ux-findings-and-proposals)

## Outcome

Users can trust every visible control and status. The app never presents invented
progress or fake configuration, destructive copy states the actual storage effect,
and overlays are operable with keyboard and assistive technology.

## User Jobs

- Understand what fotos is doing and whether work is still progressing.
- Stop or defer long-running work where the engine can do so safely.
- Know whether an operation affects only fotos metadata or an original file.
- Recover from reversible mistakes and deliberately confirm irreversible actions.

## In Scope

- Remove the infinite AI marquee and consolidate duplicate progress presentation.
- Use determinate progress only when real `current` and `total` values exist;
  otherwise show an indeterminate phase state.
- Remove or implement the hardcoded Sources and handlerless HTML Export controls.
- Remove dead navigation/icon branches and replace native `window.prompt()` flows.
- Inventory destructive actions and apply either undo or explicit confirmation.
- Correct dialog, context-menu, focus, target-size, type-size, and contrast blockers
  in touched operations.
- Discover safe pause/cancel/resume boundaries for scan, model preparation, face
  analysis, semantic analysis, and incoming sync.

## Out of Scope

- A complete app-header or sidebar redesign.
- A general toast framework beyond what is needed for safe operation feedback.
- Promising pause or cancellation before storage and worker restart semantics are known.
- Rewriting ingest, analysis, or CHUM solely to make a preferred animation possible.

## Requirements

### Progress honesty

1. A percentage or progress-bar fraction is rendered only from measured work.
2. Phase-only state uses an indeterminate indicator and a concrete phase label.
3. The same background job has one canonical visible summary; expanded detail may
   expose sub-phases without duplicating competing status surfaces.
4. Completed, failed, paused, cancelled, and resumable states are distinguishable.
5. Status announcements use appropriate live-region behavior and do not announce
   every processed photo by default.

### Control truthfulness

1. Production UI contains no handlerless button and no hardcoded source described
   as active state.
2. D-05 determines whether HTML Export is implemented or removed for v1.
3. Development-only diagnostics are gated from production UI.

### Destructive actions

1. Each action is classified as reversible, irreversible, or external-original-affecting.
2. Reversible actions prefer a time-bounded undo with an honest commit boundary.
3. Irreversible actions use a modal naming the object, scope, and consequence.
4. Delete copy distinguishes reference, metadata, and managed/ingest modes and says
   explicitly whether the original filesystem object is affected.
5. Removing a folder, collection, history branch, cluster, or analysis state cannot
   happen from an unlabeled 12px target or an unconfirmed ambiguous action.

### Modal and menu behavior

1. App-styled primitives replace `window.prompt()`.
2. Dialogs expose dialog semantics, trap focus, support Escape where safe, and return
   focus to the invoking control.
3. Context menus expose menu semantics, keyboard invocation, roving navigation, and
   focus restoration.
4. No interactive control is nested inside another interactive control.

## Dependencies and Decisions

- D-05: portable HTML export scope.
- D-07: phase-specific pause/cancel/resume semantics.
- Storage-mode behavior must be traced before delete copy is finalized.
- Undo duration and persistence boundary require engineering/product agreement.

## Implementation progress

Implemented in the first slice:

- one canonical, measured-or-indeterminate progress presentation;
- removal of invented Sources, HTML Export, duplicate marquee, and production diagnostics;
- explicit confirmations that name destructive scope and original-file effects;
- app-styled rename dialogs in place of native prompts;
- keyboard/focus semantics for dialogs, context menus, lightbox, photo cards, and
  touched sidebar/cluster controls;
- D-07 discovery: no pause/cancel/resume control is exposed before engine support exists.
- first-run controls, legal-notice controls/dialog, selection actions, control-pane actions,
  invite results, and the contact picker use the touched 44px, focus, and dialog gates.
- collection creation, membership additions, unshared collection deletion, and
  selection-scope materialization have a time-bounded undo toast in a lane that moves
  above the selection action bar.
- product text below 12px was removed, low-contrast muted text was raised to a readable
  floor, product controls receive a 44px activation box, and selection now uses sky blue
  rather than the coral primary/destructive family.

Still required before this epic is complete:

- durable failed/cancelled/resumable operation states after the engine lifecycle work in D-07;
- undo coverage for remaining reversible history/folder/people operations where the
  underlying owner can expose a real restoration transaction;
- automated destructive-routing coverage and the full desktop/mobile/manual validation matrix.

## Acceptance Criteria

- No production control is visibly enabled without a working handler.
- No status bar displays a fabricated fraction or percentage.
- A user can identify the active phase, failure, and next available action without
  opening developer diagnostics.
- Destructive operations in the audit inventory are classified and use the assigned
  confirmation or undo pattern.
- Delete confirmation names whether the original file is retained or deleted.
- Dialog and context-menu paths complete using keyboard only, with focus restored.
- Changed body copy and controls meet the cross-cutting type, contrast, and target gates.
- Automated tests cover progress-state mapping, destructive-action routing, and modal
  focus behavior where the test environment supports it.

## Validation Scenarios

1. Start each ingest/analysis phase with and without measurable totals.
2. Fail one item, fail an entire phase, reload during resumable work, and attempt cancel.
3. Exercise every destructive action in each applicable storage mode.
4. Complete prompt replacement, confirmation, undo, context menu, and dialog flows
   using keyboard only and a screen-reader smoke test.

## Success Measures

- Zero fabricated-progress and handlerless-control defects in release QA.
- Reduced abandoned/stalled phase rate without increasing corrupted or duplicated work.
- Keyboard-only completion of all modal and menu validation scenarios.

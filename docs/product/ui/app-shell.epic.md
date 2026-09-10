# Epic: App Shell and Navigation

Status: In progress
Owner: fotos product and engineering
Last updated: 2026-08-03
Evidence: [UX-09–11, UX-14, UX-17–18, UX-23](../ui.prd.md#ux-09--the-bottom-right-corner-is-contested-by-four-different-controls)

## Outcome

The main photo task uses the full viewport height while one right-hand control pane
owns browsing controls and task navigation. Primary view, search, library context,
status, identity state, Sharing, and Settings have stable homes without duplicating
them in persistent top chrome.

## User Jobs

- Know which library, view, and filters are active.
- Switch between Photos and People and search in the visible control pane.
- Maximize the gallery by collapsing the pane, with one small edge affordance to
  restore it.
- Manage library, identity, devices, and sharing in spaces sized for those tasks.

## Target Information Architecture

### Authoritative right control pane

The collapsible right pane is the only persistent control surface. Its Browse task
owns library context, the Photos/People switch, scoped search with result count,
collections, people, tags, date, sort, thumbnail size, and relevant sensitivity
controls. Peer tabs open Sharing and Settings in the same pane, widening it where a
task needs more space. Identity/sync and background status are summarized in the
pane; they are not repeated above the gallery.

Collapsing the pane is an explicit maximize-gallery state. The gallery then exposes
one small edge-mounted reopen control, not a toolbar or second navigation surface.
Breadcrumbs render only when they describe an active drill-down or filter.

### Full-pane tasks

- Settings: Identity, Library & Storage, Image AI, Devices, History, Advanced.
- Sharing: Gallery, Collections, People, Links, Received.
- Recovery setup uses a layout appropriate for a multi-step security flow.

### Status and overlays

- Background status has one control-pane summary with expandable details.
- Toasts, selection actions, and floating controls use reserved non-overlapping lanes.
- The pane close action lives in the pane; its collapsed state exposes one edge handle
  outside the bottom-right floating-control lane.

## First Run

The primary first-run action is Open photo folder on supported desktop surfaces and
Choose photos/import destination on mobile. Face and semantic configuration appears
at the moment a user enters the corresponding People or semantic-search job. Headless
connection placement depends on D-01.

## Responsive Behavior

- Desktop: full-height main pane plus the right control pane; Settings and Sharing may
  widen the pane.
- Mobile portrait: the control pane becomes a task sheet according to D-02; primary
  navigation must not depend on an undiscoverable gesture.
- Mobile landscape/tablet: the control pane may become a rail or resizable panel.
- Breakpoint changes preserve the active library, view, query, filters, selection, and
  open task unless the destination cannot represent it.

## In Scope

- Control-pane navigation, breadcrumbs, search placement/scope, Photos/People switch,
  and collapse/reopen behavior.
- Reallocation of current sidebar features to facets, Settings, Sharing, or Advanced.
- Floating-control and toast lanes.
- First-run hierarchy and identity-status visibility.
- Navigation semantics, responsive states, and route/back behavior for full-pane tasks.

## Out of Scope

- Reimplementing search ranking or semantic models.
- Sharing grant mechanics covered by the Sharing epic.
- A full visual-brand redesign.
- Mobile-sheet physics beyond what is necessary to deliver the D-02 decision.
- Redesigning Breadcrumb History before D-04.

## Implementation Status

Implemented:

- Browse, Sharing, and Settings are explicit peer navigation destinations; sharing is
  no longer rendered as a Browse section.
- Folder add, switch, remove, rescan, and reanalysis controls are consolidated under
  Settings → Library instead of appearing in Browse or Sharing.
- The redundant persistent app header is removed; Photos/People, scoped search,
  result count, identity/sync state, background status, and pane visibility live in
  the authoritative right control pane.
- The gallery preserves its full height and exposes only a small edge-mounted reopen
  affordance when the pane is collapsed.
- First run presents one dominant library-intake action and a local-originals privacy
  promise. AI setup moved to the People job and settings; headless connection is
  development-only Advanced UI.
- A failed literal search offers semantic search enablement at the moment it is useful,
  rather than making model configuration a first-run requirement.
- Sharing and Settings write a persistent `task` route while preserving photo and
  invite parameters; browser back/forward restores the task destination.
- The legal notice remains reachable after a library opens and its dialog/targets meet
  the touched accessibility contract.

Still required for completion: run the populated-library responsive navigation matrix.

## Dependencies and Decisions

- Unified Selection must define where its action bar and state survive navigation.
- Trustworthy Operations must define the canonical status summary.
- D-01 headless path, D-02 mobile shell, D-04 history, and D-06 AI Audit block
  affected navigation decisions.
- Existing URL/deep-link and browser-history behavior must be inventoried before routes
  are changed.

## Acceptance Criteria

- Library, primary view, search, identity/sync state, and task navigation have exactly
  one persistent home in the right control pane.
- Collapsing the pane maximizes the gallery and leaves one discoverable reopen handle;
  it does not preserve a second top toolbar.
- Search communicates its scope and result count.
- Sharing is not housed under Browse; identity and recovery are not squeezed into the
  facets panel.
- No two floating controls or toast/action surfaces overlap at supported viewport sizes.
- Browser back/forward and deep links preserve or restore the documented view state.
- First run presents one dominant intake action before optional AI configuration.
- Desktop, mobile portrait, and mobile landscape pass the same orientation and primary
  navigation tasks using keyboard/touch appropriate to the surface.
- Changed shell components satisfy all cross-cutting accessibility gates.

## Validation Scenarios

1. Open, search, switch view, open Settings, return, collapse the pane, and reopen it
   without state loss.
2. Switch libraries with active filters and selection; verify the specified reset boundary.
3. Enter by photo and share deep links, then exercise browser back/forward.
4. Run first use, restored-library use, and pending-mobile-import use at each viewport class.
5. Trigger background status, selection, update, and incoming-share feedback together.

## Success Measures

- Search and Photos/People switching remain immediately available in the default
  control pane without reducing gallery height.
- The collapsed gallery has one discoverable route back to the control pane.
- Keyboard-only completion of orientation, search, and settings-return scenarios.

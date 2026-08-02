# Epic: App Shell and Navigation

Status: In progress
Owner: fotos product and engineering
Last updated: 2026-08-02
Evidence: [UX-09–11, UX-14, UX-17–18, UX-23](../ui.prd.md#ux-09--the-bottom-right-corner-is-contested-by-four-different-controls)

## Outcome

The main photo task remains oriented and usable when filters are collapsed. Primary
view, search, library context, status, identity state, and navigation have stable
homes. Settings, sharing, and advanced tools no longer compete inside a 256px filter
column.

## User Jobs

- Know which library, view, and filters are active.
- Switch between Photos and People and search without opening a utility panel.
- Collapse filters without losing primary navigation or status.
- Manage library, identity, devices, and sharing in spaces sized for those tasks.

## Target Information Architecture

### Persistent app header

- Library identity/switcher.
- Photos/People primary-view control.
- Search entry point with explicit scope and result count.
- Identity/sync state indicator that does not require opening settings.
- Overflow entry for Sharing, Settings, and applicable library actions.
- Filter/sidebar toggle.
- A second row for breadcrumbs and active-filter summary when needed.

### Facets panel

The collapsible side panel contains browsing facets only: collections, people, tags,
date, sort, thumbnail size, and relevant sensitivity controls. It does not contain
identity setup, recovery, devices, storage configuration, broad sharing management,
or development diagnostics.

### Full-pane tasks

- Settings: Identity, Library & Storage, Image AI, Devices, History, Advanced.
- Sharing: Gallery, Collections, People, Links, Received.
- Recovery setup uses a layout appropriate for a multi-step security flow.

### Status and overlays

- Background status has one header-level summary with expandable details.
- Toasts, selection actions, and floating controls use reserved non-overlapping lanes.
- The filter toggle lives in the header, not in the floating-control lane.

## First Run

The primary first-run action is Open photo folder on supported desktop surfaces and
Choose photos/import destination on mobile. Face and semantic configuration appears
at the moment a user enters the corresponding People or semantic-search job. Headless
connection placement depends on D-01.

## Responsive Behavior

- Desktop: persistent header, optional facets column, main pane, full-pane settings.
- Mobile portrait: persistent compact header; filters use a sheet or full-screen view
  according to D-02; primary navigation must not depend on an undiscoverable gesture.
- Mobile landscape/tablet: header remains; facets may become a rail or resizable panel.
- Breakpoint changes preserve the active library, view, query, filters, selection, and
  open task unless the destination cannot represent it.

## In Scope

- Header, breadcrumbs, search placement/scope, Photos/People switch, filter toggle.
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

- A persistent header owns library context, Photos/People switching, scoped search
  with result counts, identity/sync state, background status, panel visibility,
  Sharing, and Settings entry points.
- Browse, Sharing, and Settings are explicit peer navigation destinations; sharing is
  no longer rendered as a Browse section.
- Desktop sidebar collapse controls were removed from the contested floating-control
  lane; header controls now own panel visibility.
- Folder add, switch, remove, rescan, and reanalysis controls are consolidated under
  Settings → Library instead of appearing in Browse or Sharing.
- First run presents one dominant library-intake action and a local-originals privacy
  promise. AI setup moved to the People job and settings; headless connection is
  development-only Advanced UI.
- A failed literal search offers semantic search enablement at the moment it is useful,
  rather than making model configuration a first-run requirement.
- The legal notice remains reachable after a library opens and its dialog/targets meet
  the touched accessibility contract.

Still required for completion: finish route-backed full-pane task history and run the
populated-library responsive navigation matrix.

## Dependencies and Decisions

- Unified Selection must define where its action bar and state survive navigation.
- Trustworthy Operations must define the canonical status summary.
- D-01 headless path, D-02 mobile shell, D-04 history, and D-06 AI Audit block
  affected navigation decisions.
- Existing URL/deep-link and browser-history behavior must be inventoried before routes
  are changed.

## Acceptance Criteria

- Library, primary view, search, identity/sync state, and filter navigation remain
  accessible with the facets panel collapsed.
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

1. Open, collapse filters, search, switch view, open settings, and return without state loss.
2. Switch libraries with active filters and selection; verify the specified reset boundary.
3. Enter by photo and share deep links, then exercise browser back/forward.
4. Run first use, restored-library use, and pending-mobile-import use at each viewport class.
5. Trigger background status, selection, update, and incoming-share feedback together.

## Success Measures

- Reduced steps to search and Photos/People switching from the default gallery.
- No supported state in which collapsing facets removes all primary navigation.
- Keyboard-only completion of orientation, search, and settings-return scenarios.

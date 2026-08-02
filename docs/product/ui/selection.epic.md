# Epic: Unified Selection

Status: Proposed
Owner: fotos product and engineering
Last updated: 2026-08-02
Evidence: [UX-01–02](../ui.prd.md#ux-01--three-incompatible-selection-models-for-the-same-concept)

## Outcome

Photos and people follow one predictable selection interaction contract, and one
authoritative action bar explains what is selected and which actions are valid.
Collections, people management, export, sharing, and deletion no longer maintain
competing selection modes or toolbars.

## User Jobs

- Select one or many visible photos or people without first finding a mode toggle.
- Understand whether selection persists when filtering or navigating.
- Apply an action to exactly the objects named by the selection summary.
- Clear or amend selection consistently with pointer, touch, and keyboard.

## Product Contract

### State ownership

- One App-level coordinator owns selection mutations and summaries.
- Photo and people identifiers may remain separate domain sets. Unification means one
  behavioral contract, not a requirement to erase domain types.
- Components receive selected state and explicit mutation callbacks; they do not keep
  an independent authoritative selection set.
- Selection is scoped to the active library. Switching libraries clears it.

### Interaction rules

1. With no selection, activating an item opens it. Its visible checkbox or the
   platform modifier gesture starts selection without opening it.
2. While selection is active in a surface, plain item activation toggles membership.
3. Shift extends a range within the current ordered surface; Command/Control toggles.
4. `x` or Space toggles the focused item when focus is in a selectable grid/list.
5. Escape clears selection before closing the surrounding view or dialog.
6. Touch exposes a visible checkbox on focus/press and supports long-press only as a
   secondary accelerator, not the sole entry point.
7. Filtering does not silently drop selected objects. The summary distinguishes
   selected total from selected currently visible and offers “Clear hidden selection.”

### Heterogeneous selection

Photo and people selection may coexist only for actions whose semantics support both.
The action bar never applies a partially compatible action silently.

| Action | Photos | People | Combined |
|---|---:|---:|---:|
| Clear | Yes | Yes | Yes |
| Add to collection | Yes | Yes | Yes, if collection membership supports both |
| Share | Yes | Yes | Only after scope is shown separately in review |
| Export | Yes | No | No; explain why unavailable |
| Delete/remove | Yes | Yes | No; require domain-specific action |
| Name/group/merge | No | Yes | No |

If collection or sharing storage cannot represent both domains without ambiguity,
combined selection is disabled and the UI explains the boundary. Engineering must
confirm this representation before implementation.

### Action surface

- Exactly one selection action bar is shown in the main pane.
- It reports domain-aware counts, including hidden selected objects.
- It contains only valid primary actions; unavailable actions are either absent or
  disabled with an accessible explanation when that explanation prevents confusion.
- “Select all” states whether it means visible results or the entire library. The v1
  default is “Select all visible.”
- “New collection…” is an outcome of Add to collection, not a separate sidebar mode.

## In Scope

- Photo grid, people/cluster grid, sidebar rows that remain after shell work, and the
  current floating/sticky selection toolbars.
- Collection creation from selection, people naming/grouping/merge entry points,
  export, sharing handoff, clear, and select-visible.
- Focus, keyboard, range-selection, hidden-selection, and responsive action-bar states.

## Out of Scope

- Redesigning the complete collection data model.
- Sharing grant confirmation and recipient management; this epic only hands an
  explicit selected scope to the Sharing epic.
- Bulk operations over an unmaterialized “all matching” query unless separately scoped.

## Acceptance Criteria

- No grid or row owns an authoritative local selection store.
- No explicit “Select People” mode is required.
- Only one selection action bar is visible at a time.
- Counts and enabled actions derive from the same coordinator state.
- Filter changes preserve selection and disclose hidden selected objects.
- Library changes clear selection; other navigation behavior is specified and tested.
- Unsupported combined actions never affect a compatible subset silently.
- Pointer, touch, keyboard, and screen-reader users can select, range-select where
  supported, inspect the summary, invoke an action, and clear selection.
- Selection visuals do not rely on color alone and meet contrast requirements.

## Validation Scenarios

1. Select photos, filter some out, add visible and hidden items to a collection, undo.
2. Select people from both card and list presentations; name, group, and merge.
3. Create a supported combined selection and inspect every action state.
4. Switch collection, people detail, lightbox, filter, and library while selected.
5. Repeat the core scenarios with keyboard only and at mobile portrait width.

## Success Measures

- No mismatch between visible selection count and action payload in automated tests.
- Reduced steps from first selected object to collection creation.
- Successful keyboard-only completion of photo and people bulk-action scenarios.

# fotos UI Audit — Flow Inventory and UX Findings

Status: Evidence draft
Owner: fotos product and engineering
Last updated: 2026-08-02
Related: [PRD](./PRD.md), [MRD](./MRD.md), [UI delivery plan](./ui/README.md)

## 1. Purpose and Scope

This document is the evidence source for UI product work. It does two things:

1. **Inventories every user-facing flow** currently implemented in the fotos UI, with its entry point, surface, and current behaviour.
2. **Records UX findings and directional proposals**, each anchored to the code that would change.

It is deliberately not an implementation specification. Decisions, dependencies,
success measures, and delivery acceptance criteria live in the bounded epics linked
from the [UI delivery plan](./ui/README.md). Finding identifiers are stable; their
delivery priority may change as product decisions and technical discovery progress.

Scope is the shipping browser app `fotos.browser/browser-ui` plus the shared UI primitives it consumes from `fotos.ui`. The portable fallback viewer (`fotos.html`) and the Expo shell (`fotos.expo`) are referenced only where they diverge.

Primary files reviewed:

| Surface | File | Size |
|---|---|---|
| App shell, routing, share orchestration | [App.tsx](../../fotos.browser/browser-ui/src/App.tsx) | 2740 |
| Sidebar (browse + settings + sharing + folders) | [Sidebar.tsx](../../fotos.browser/browser-ui/src/components/Sidebar.tsx) | 2746 |
| Identity / fotos id / recovery | [FotosSettings.tsx](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx) | 1356 |
| Photo viewer | [Lightbox.tsx](../../fotos.browser/browser-ui/src/components/Lightbox.tsx) | 903 |
| Photo grid | [PhotoGrid.tsx](../../fotos.ui/src/components/PhotoGrid.tsx) | 454 |
| People/cluster grid | [ClusterGallery.tsx](../../fotos.browser/browser-ui/src/components/ClusterGallery.tsx) | 397 |
| Timeline scrubber | [TimelineScrubber.tsx](../../fotos.browser/browser-ui/src/components/TimelineScrubber.tsx) | 353 |
| Peer picker | [ShareWithField.tsx](../../fotos.browser/browser-ui/src/components/ShareWithField.tsx) | 550 |
| Context menu / confirm | [ContextMenu.tsx](../../fotos.browser/browser-ui/src/components/ContextMenu.tsx), [ConfirmModal.tsx](../../fotos.browser/browser-ui/src/components/ConfirmModal.tsx) | 239 / 120 |
| Folder + ingest state machine | [useFolderAccess.ts](../../fotos.browser/browser-ui/src/hooks/useFolderAccess.ts) | 3876 |
| Intake planning | [gallery-intake.ts](../../fotos.core/src/gallery-intake.ts) | 316 |

---

## 2. Current Information Architecture

```
Landing (no folder open)
├── AI opt-in toggles (face analytics, semantic search)
├── Claim authorship on ingest (conditional)
├── PRIMARY: Open photo folder / Select photos   ← surface-dependent label
├── OR: Connect to server (headless URL)
└── Impressum footer

Gallery (folder open)
├── Main pane
│   ├── Breadcrumbs                    (only when a filter/detail is active)
│   ├── PhotoGrid | ClusterGallery     (mode switch lives in the sidebar)
│   ├── TimelineScrubber               (bottom-right FAB, hold-to-scrub)
│   ├── Floating selection toolbar     (when photos selected)
│   └── Onboarding coach marks
├── Sidebar (256px desktop / bottom sheet mobile portrait / rail mobile landscape)
│   ├── Tab: Browse
│   │   ├── BrowseTab: summary, mode toggle, Collections builder, search,
│   │   │   sensitivity, People, Groups, Similar Faces, size, sort, tags, Faces
│   │   └── LibrarySharingPanel: Folders, Share gallery, Collection Sharing,
│   │       Cluster Sharing
│   └── Tab: Settings
│       ├── SettingsTab: fotos id, Storage, Image AI, Breadcrumb History, Devices
│       └── LibraryConfigPanel: Ingestion, Default mode, Sources, Export, AI Audit
└── Overlays: Lightbox, ContextMenu, ConfirmModal, UpdatePrompt,
    incoming-share modal, incoming-share progress toast
```

Surface behaviour is planned by `planGalleryIntake()` ([gallery-intake.ts:167](../../fotos.core/src/gallery-intake.ts#L167)): desktop browser attaches a writable filesystem library with local face enrichment; mobile browser captures a photo selection with `faceEnrichment: 'remote'` and no sidecars. The UI reflects this only through a changed button label and summary string.

---

## 3. Flow Inventory

Legend for **State**: ✅ complete · ⚠️ works but has UX defects listed in §4 · 🚧 partial · ❌ non-functional.

### 3.1 Entry and first run

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F1 | Cold open, no library | App load | [App.tsx:2249](../../fotos.browser/browser-ui/src/App.tsx#L2249) | ⚠️ |
| F2 | Opt into face analytics before ingest | Landing checkbox | [App.tsx:2255](../../fotos.browser/browser-ui/src/App.tsx#L2255) | ⚠️ |
| F3 | Opt into semantic search before ingest | Landing checkbox | [App.tsx:2270](../../fotos.browser/browser-ui/src/App.tsx#L2270) | ⚠️ |
| F4 | Claim authorship on ingest | Landing checkbox (conditional) | [App.tsx:2290](../../fotos.browser/browser-ui/src/App.tsx#L2290) | ✅ |
| F5 | Open photo folder (desktop, FS Access) | Primary CTA | [App.tsx:2306](../../fotos.browser/browser-ui/src/App.tsx#L2306) | ✅ |
| F6 | Select photos (mobile capture-selection) | Same CTA, relabelled | `defaultIntakePlan.actionLabel` | ⚠️ |
| F7 | Store pending shared photos | CTA relabels to "Choose folder for N shared photos" | [App.tsx:1066](../../fotos.browser/browser-ui/src/App.tsx#L1066) | ⚠️ |
| F8 | Connect to headless server | "Connect to server" → URL field | [App.tsx:2319](../../fotos.browser/browser-ui/src/App.tsx#L2319) | ⚠️ |
| F9 | PWA install + OS share-target intake | Manifest / share target | `supportsShareTarget` in intake profile | 🚧 |
| F10 | App update available | Toast | [UpdatePrompt.tsx](../../fotos.browser/browser-ui/src/components/UpdatePrompt.tsx) | ✅ |
| F11 | Deep link to a photo (`?photo=`) | URL | [App.tsx:1092](../../fotos.browser/browser-ui/src/App.tsx#L1092) | ✅ |
| F12 | Deep link to a share invite | URL | [App.tsx:293](../../fotos.browser/browser-ui/src/App.tsx#L293) | ⚠️ |
| F13 | Onboarding coach marks | Auto on first gallery load | [App.tsx:408](../../fotos.browser/browser-ui/src/App.tsx#L408) | ⚠️ |

### 3.2 Ingest and analysis

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F14 | Scan → process → write metadata | After folder pick | Blocking overlay, [App.tsx:2201](../../fotos.browser/browser-ui/src/App.tsx#L2201) | ⚠️ |
| F15 | Face model download + detection pass | Auto when enabled | `progress.phase = preparing-faces \| faces` | ⚠️ |
| F16 | Semantic model download + embedding pass | Auto when enabled | `progress.phase = preparing-semantic \| semantic` | ⚠️ |
| F17 | Rescan folder | Sidebar → Browse → Folders | [Sidebar.tsx:1903](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1903) | ⚠️ |
| F18 | Reanalyze image AI | Sidebar → Browse → Folders | [Sidebar.tsx:1908](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1908) | ⚠️ |
| F19 | Add another managed folder | "+" in Folders section | [Sidebar.tsx:1837](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1837) | ⚠️ |
| F20 | Switch active folder | Click folder row | [Sidebar.tsx:1861](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1861) | ⚠️ |
| F21 | Remove managed folder | Trash icon on folder row | [Sidebar.tsx:1876](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1876) | ⚠️ |

### 3.3 Browsing and finding

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F22 | Timeline grid, grouped by capture day | Default view | [PhotoGrid.tsx:235](../../fotos.ui/src/components/PhotoGrid.tsx#L235) | ✅ |
| F23 | Change thumbnail size | Sidebar → Size slider | [Sidebar.tsx:788](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L788) | ✅ |
| F24 | Sort by date / name / added, asc/desc | Sidebar → Sort | [Sidebar.tsx:1323](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1323) | ⚠️ |
| F25 | Scroll to top | Bottom-right FAB | [TimelineScrubber.tsx:295](../../fotos.browser/browser-ui/src/components/TimelineScrubber.tsx#L295) | ⚠️ |
| F26 | Enter scrub mode (300 ms press-and-hold) | Same FAB | [TimelineScrubber.tsx:317](../../fotos.browser/browser-ui/src/components/TimelineScrubber.tsx#L317) | ⚠️ |
| F27 | Drag-scrub with month/year bubble | Scrub track | [TimelineScrubber.tsx:118](../../fotos.browser/browser-ui/src/components/TimelineScrubber.tsx#L118) | ✅ |
| F28 | Filter by tag | Sidebar → Tags pills | [Sidebar.tsx:1345](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1345) | ✅ |
| F29 | Text / semantic search | Sidebar search input | [Sidebar.tsx:1103](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1103) | ⚠️ |
| F30 | Switch Images ↔ Clusters | Sidebar → Gallery pills | [Sidebar.tsx:978](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L978) | ⚠️ |
| F31 | Browse people/cluster cards | Clusters mode, main pane | [ClusterGallery.tsx:182](../../fotos.browser/browser-ui/src/components/ClusterGallery.tsx#L182) | ✅ |
| F32 | Open one cluster's photos | Click cluster card | `setActiveClusterId` | ✅ |
| F33 | Open a collection | Sidebar → Collections row | [Sidebar.tsx:1087](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1087) | ✅ |
| F34 | Clear filters via breadcrumbs | Breadcrumb crumb click | [App.tsx:1279](../../fotos.browser/browser-ui/src/App.tsx#L1279) | ⚠️ |
| F35 | Browser back/forward across photo route | History API | [App.tsx:1104](../../fotos.browser/browser-ui/src/App.tsx#L1104) | ✅ |
| F36 | Save / restore synced breadcrumb branches | Settings → Breadcrumb History | [Sidebar.tsx:2449](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2449) | ⚠️ |

### 3.4 Photo viewer (lightbox)

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F37 | Open photo | Click card / Enter | [App.tsx:1227](../../fotos.browser/browser-ui/src/App.tsx#L1227) | ✅ |
| F38 | Navigate prev/next | Arrows, click left/right third, swipe | [Lightbox.tsx:287](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L287) | ⚠️ |
| F39 | Zoom fit / 1:1 / ± / wheel / pinch | Controls, keys, gestures | [Lightbox.tsx:120](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L120) | ✅ |
| F40 | Pan when zoomed | Drag / touch drag | [Lightbox.tsx:182](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L182) | ✅ |
| F41 | Rotate / flip H / flip V | Controls, `r`/`l`/`h`/`v` | [Lightbox.tsx:683](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L683) | ⚠️ |
| F42 | Fullscreen with auto-hiding chrome | Bottom-right chevron | [Lightbox.tsx:552](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L552) | ⚠️ |
| F43 | Toggle details sidebar | Info button / `i` | [Lightbox.tsx:587](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L587) | ✅ |
| F44 | Read EXIF + tags | Details sidebar | [Lightbox.tsx:644](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L644) | ✅ |
| F45 | Find similar faces from a crop | Click face crop | [Lightbox.tsx:830](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L830) | ⚠️ |
| F46 | Rename a face inline | Face row | [Lightbox.tsx:852](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L852) | ✅ |
| F47 | Assign face to existing person ("This is…") | Face row select | [Lightbox.tsx:862](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L862) | ⚠️ |
| F48 | Delete face cluster from viewer | Trash on face row | [Lightbox.tsx:888](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L888) | ⚠️ |
| F49 | Delete photo, advance to neighbour | Delete key / action | [App.tsx:1144](../../fotos.browser/browser-ui/src/App.tsx#L1144) | ⚠️ |
| F50 | Export to Photos (mobile) | Actions section | [Lightbox.tsx:695](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L695) | ✅ |

### 3.5 People and face management

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F51 | Adjust cluster sensitivity | Sidebar slider (clusters mode) | [Sidebar.tsx:1117](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1117) | ⚠️ |
| F52 | Select clusters in the main grid, name/group | ClusterGallery selection bar | [ClusterGallery.tsx:134](../../fotos.browser/browser-ui/src/components/ClusterGallery.tsx#L134) | ⚠️ |
| F53 | Rename a cluster inline (3 places) | Cluster card / sidebar row / lightbox | `InlineRenameField` | ⚠️ |
| F54 | Rename a cluster via context menu | Right-click / long-press | `window.prompt`, [App.tsx:524](../../fotos.browser/browser-ui/src/App.tsx#L524) | ⚠️ |
| F55 | Merge candidate clusters into active cluster | Sidebar merge checkboxes → "Merge Selected" | [Sidebar.tsx:1159](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1159) | ⚠️ |
| F56 | Collapse clusters into one person | "One Person" | [Sidebar.tsx:1170](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1170) | ⚠️ |
| F57 | Separate a person group back into clusters | "Separate Clusters" | [Sidebar.tsx:1198](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1198) | ⚠️ |
| F58 | Associate a similar face with active cluster | Check button on Similar Faces row | [Sidebar.tsx:1748](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1748) | ⚠️ |
| F59 | Open a similar-face result | Click row | [App.tsx:1547](../../fotos.browser/browser-ui/src/App.tsx#L1547) | ✅ |
| F60 | Delete a face cluster | Trash icon / context menu | [App.tsx:513](../../fotos.browser/browser-ui/src/App.tsx#L513) | ✅ |

### 3.6 Collections

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F61 | Select photos (implicit selection) | Click after first select, ⌘/Ctrl/Shift-click, hover checkbox, `x`/space | [PhotoGrid.tsx:347](../../fotos.ui/src/components/PhotoGrid.tsx#L347) | ✅ |
| F62 | Select people (explicit mode) | "Select People" toggle → row checkboxes | [Sidebar.tsx:1001](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1001) | ⚠️ |
| F63 | Select all visible | Sidebar or floating toolbar | [App.tsx:783](../../fotos.browser/browser-ui/src/App.tsx#L783) | ⚠️ |
| F64 | Clear selection | Toolbar / sidebar / Escape | [PhotoGrid.tsx:146](../../fotos.ui/src/components/PhotoGrid.tsx#L146) | ⚠️ |
| F65 | Create collection from selection | Name field + Create | [Sidebar.tsx:950](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L950) | ⚠️ |
| F66 | Rename collection | Inline field, or context menu → `prompt` | [App.tsx:532](../../fotos.browser/browser-ui/src/App.tsx#L532) | ⚠️ |
| F67 | Delete collection | Trash icon (3 places), context menu | [Sidebar.tsx:1504](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1504) | ⚠️ |

### 3.7 Sharing

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F68 | Create gallery share link + PIN | Browse → Share gallery | [App.tsx:913](../../fotos.browser/browser-ui/src/App.tsx#L913) | ⚠️ |
| F69 | Recipient opens invite link | Blocking modal | [App.tsx:2608](../../fotos.browser/browser-ui/src/App.tsx#L2608) | ⚠️ |
| F70 | Recipient picks destination folder | Modal CTA | [App.tsx:987](../../fotos.browser/browser-ui/src/App.tsx#L987) | ⚠️ |
| F71 | Guest identity auto-provision + reload | Implicit | [App.tsx:1002](../../fotos.browser/browser-ui/src/App.tsx#L1002) | ⚠️ |
| F72 | Pairing + CHUM sync of shared gallery | Automatic | [App.tsx:1027](../../fotos.browser/browser-ui/src/App.tsx#L1027) | ⚠️ |
| F73 | Watch incoming sync progress | Bottom toast | [App.tsx:2670](../../fotos.browser/browser-ui/src/App.tsx#L2670) | ⚠️ |
| F74 | Share whole gallery with named peers | ShareWithField | [Sidebar.tsx:1962](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1962) | ⚠️ |
| F75 | Share a collection | Collection Sharing section | [Sidebar.tsx:1972](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1972) | ⚠️ |
| F76 | Share a face cluster | Cluster Sharing section | [Sidebar.tsx:1994](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1994) | ⚠️ |
| F77 | Resolve a peer by name / @identity / person id | ShareWithField draft commit | [ShareWithField.tsx:396](../../fotos.browser/browser-ui/src/components/ShareWithField.tsx#L396) | ⚠️ |
| F78 | Accept incoming sharing (advertise identity) | Settings → fotos id → Accept sharing | [FotosSettings.tsx:1061](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L1061) | ⚠️ |
| F79 | Auto re-grant access when manifest changes | Background | [App.tsx:1780](../../fotos.browser/browser-ui/src/App.tsx#L1780) | ✅ |
| F80 | Native-share a single photo | Context menu → Share Photo | [App.tsx:1216](../../fotos.browser/browser-ui/src/App.tsx#L1216) | ✅ |
| F81 | Export selected photos to Photos | Toolbar / sidebar (mobile) | [App.tsx:1208](../../fotos.browser/browser-ui/src/App.tsx#L1208) | ✅ |

### 3.8 Identity, security, recovery

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F82 | Choose user ID → Prepare authentication | Settings → fotos id | [FotosSettings.tsx:374](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L374) | ⚠️ |
| F83 | Forced reload, return to Settings tab | Automatic | `queueAuthenticationContinuation` | ⚠️ |
| F84 | Authenticate at glue.one (passkey popup) | Same button, second press | [FotosSettings.tsx:818](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L818) | ⚠️ |
| F85 | Save a passkey | Prompt after first auth | [FotosSettings.tsx:885](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L885) | ⚠️ |
| F86 | Register a photo-derived recovery key | Pick photos → reorder → passphrase → derive | [FotosSettings.tsx:1109](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L1109) | ⚠️ |
| F87 | Recover with fotos proof (name taken) | Warning panel | [FotosSettings.tsx:1026](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L1026) | ⚠️ |
| F88 | Recover with recovery key | Warning panel | [FotosSettings.tsx:1039](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L1039) | ⚠️ |
| F89 | Change user ID | "Change user ID" | [FotosSettings.tsx:911](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L911) | ⚠️ |
| F90 | Disable sync (logout) | Footer link, forces reload | [FotosSettings.tsx:708](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L708) | ⚠️ |

### 3.9 Settings and configuration

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F91 | Storage: blob dir, thumb dir, thumb size, quota, min copies | Settings → Storage | [Sidebar.tsx:2350](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2350) | ⚠️ |
| F92 | Default storage mode (reference/metadata/ingest) | Settings → Ingestion | [Sidebar.tsx:2055](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2055) | ⚠️ |
| F93 | Image AI toggles | Settings → Image AI | [Sidebar.tsx:2402](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2402) | ✅ |
| F94 | Devices: name, discovery, auto-connect, trust, visibility | Settings → Devices | [Sidebar.tsx:2512](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2512) | ⚠️ |
| F95 | Breadcrumb history recording toggle | Settings → History | [Sidebar.tsx:2450](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2450) | ⚠️ |
| F96 | Sources list (`~/Downloads`, `~/Pictures`) | Settings → Sources | [Sidebar.tsx:2074](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2074) | ❌ hardcoded |
| F97 | Export as HTML | Settings → Export | [Sidebar.tsx:2081](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2081) | ❌ no handler |
| F98 | AI Audit / LLM comparison | Settings → AI Audit | [Sidebar.tsx:2086](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2086) | ⚠️ dev tool |
| F99 | Impressum | Landing footer only | [Impressum.tsx](../../fotos.browser/browser-ui/src/components/Impressum.tsx) | ⚠️ |

### 3.10 Chrome, menus, layout

| # | Flow | Entry point | Implementation | State |
|---|---|---|---|---|
| F100 | Photo context menu (share / select / delete) | Right-click, 600 ms long-press | [ContextMenu.tsx:121](../../fotos.browser/browser-ui/src/components/ContextMenu.tsx#L121) | ⚠️ |
| F101 | Cluster context menu (rename / delete) | Right-click, long-press | [ContextMenu.tsx:155](../../fotos.browser/browser-ui/src/components/ContextMenu.tsx#L155) | ⚠️ |
| F102 | Collection context menu (rename / delete) | Right-click, long-press | [ContextMenu.tsx:180](../../fotos.browser/browser-ui/src/components/ContextMenu.tsx#L180) | ⚠️ |
| F103 | Collapse / expand sidebar (desktop) | Floating circle bottom-right | [Sidebar.tsx:594](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L594) | ⚠️ |
| F104 | Mobile sheet: collapsed / half / full | Tab tap, vertical drag on handle | [Sidebar.tsx:199](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L199) | ⚠️ |
| F105 | Dismiss onboarding | ✕ on any coach mark | [App.tsx:417](../../fotos.browser/browser-ui/src/App.tsx#L417) | ⚠️ |
| F106 | Confirm a destructive action | ConfirmModal | [ConfirmModal.tsx](../../fotos.browser/browser-ui/src/components/ConfirmModal.tsx) | ✅ |

**Total: 106 distinct user-facing flows**, of which 2 are non-functional and roughly 60 carry UX defects captured below.

---

## 4. UX Findings and Proposals

Each finding has a stable `UX-xx` identifier and a mutable delivery priority:

- **P0 — release gate:** trust, data safety, or fundamental access is compromised.
- **P1 — structural:** the product works, but a core task or information architecture is incoherent.
- **P2 — enhancement:** discovery, efficiency, or interaction quality can improve without gating release.

Each item states the observed problem, then a directional proposal. The linked epics
own final scope and acceptance criteria.

### UX-01 — Three incompatible selection models for the same concept

**Priority: P1 — structural.**

**Problem.** "Select some people" behaves differently in three places, and two of them do not talk to each other:

- `ClusterGallery` (main pane) keeps its own local `selectedIds` ([ClusterGallery.tsx:34](../../fotos.browser/browser-ui/src/components/ClusterGallery.tsx#L34)) and uses implicit selection. Its only outcome is *name / name & group*. It never contributes to a collection.
- The sidebar cluster rows use an explicit mode toggle, `clusterSelectionEnabled` → "Select People" / "Done People" ([Sidebar.tsx:1001](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1001)), writing to App-level `selectedClusterIds`, which *is* what the Collections builder consumes.
- A third selection, `selectedClusterCandidateIds` ([Sidebar.tsx:918](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L918)), drives merge. Its checkbox can render on the *same row* as the collection checkbox ([Sidebar.tsx:1218-1223](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1218)) — two unlabelled 16px checkboxes side by side, distinguished only by `title` text.

Meanwhile `PhotoGrid` documents the intended model: *"Selection is now implicit… the grid no longer requires a mode to be toggled"* ([PhotoGrid.tsx:11](../../fotos.ui/src/components/PhotoGrid.tsx#L11)). The people surfaces never got the memo.

**Proposal.** One selection interaction contract and one authoritative coordinator.

1. Lift selection coordination into App state; delete `ClusterGallery`'s local set and the `clusterSelectionEnabled` mode entirely. Photo and people identifiers may remain domain-specific sets, but every surface must read and mutate them through the same contract.
2. Apply implicit selection everywhere: first modifier-click or checkbox click starts a selection; plain click toggles while a selection is active; Escape clears; `x`/space toggles the focused item. This is already implemented in `PhotoCard.handleCardClick` and `ClusterCard.handleClick` — reuse it verbatim.
3. Replace merge-checkboxes with a **selection-driven action**: with 2+ people selected, the unified action bar offers `Name…`, `Merge into…`, `Group as one person`. Merge target = the active cluster if one is open, otherwise a target picker. Never render two checkboxes on one row.

### UX-02 — Three selection toolbars, none authoritative

**Priority: P1 — structural.**

**Problem.** With photos selected the user sees a floating toolbar ("N selected · Clear · Select all · Export", [App.tsx:2449](../../fotos.browser/browser-ui/src/App.tsx#L2449)); the sidebar Collections block simultaneously shows "Select People / Select Visible / Export to Photos / Clear" plus its own count line ([Sidebar.tsx:1000-1048](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1000)); and `ClusterGallery` shows a third sticky bar. Counts, verbs, and available actions differ across all three ("Select all" vs "Select Visible"; Export appears only on mobile in one place and unconditionally in another).

**Proposal.** A single **selection action bar**, docked bottom-centre in the main pane, that is the only place selection actions live. Contents adapt to what is selected:

```
[ 12 photos, 2 people selected ]  Clear · Select all
[ Add to collection ▾ ] [ Name… ] [ Share… ] [ Export ] [ Delete ]
```

Remove selection controls from the sidebar Collections block; it becomes a plain list of collections plus an empty state. "Create collection" moves into the `Add to collection ▾` menu as *"New collection…"*.

### UX-03 — Sharing grants are silent, immediate, and unreviewable

**Priority: P0 — release gate.**

**Problem.** Adding a chip in `ShareWithField` immediately calls `grantNewPeers` → `grantFotosAccess` ([App.tsx:844-872](../../fotos.browser/browser-ui/src/App.tsx#L844)), granting CHUM access to real photos. There is no confirmation, no summary of what is being shared ("your whole gallery — 4,812 photos"), no undo, and nothing in the gallery header ever indicates that a library or collection *is* shared. Revocation is only implicit — removing a chip changes the wanted-peer set, but no UI states whether already-synced content is retracted. Peer resolution failure is a single flat string, "No matching glue identity or person id found." ([ShareWithField.tsx:406](../../fotos.browser/browser-ui/src/components/ShareWithField.tsx#L406)), after a ten-strategy resolver that the user cannot see into.

**Proposal.**

1. **Explicit share step.** Chips stage a change; a `Share` button commits it behind a confirm sheet that names scope, recipient, and item count: *"Share **Summer 2025** (218 photos) with **anna@glue.one**? They will be able to download originals."*
2. **Persistent share state.** A shared indicator (avatar stack + count) on the gallery header, collection rows, and cluster rows, clicking through to a "Shared with" panel. Today the only trace is a chip buried three collapsible sections deep.
3. **Explicit revoke.** Removing a recipient publishes a newer revocation version of
   the sharing certificate and removes derived access to the affected fotos roots,
   stopping future photos and updates. It does not remotely delete photos already
   synchronized or saved by the recipient. Confirm with that exact distinction.
4. **Real peer picker.** Replace free-text-first with a list-first picker: online contacts with avatars and presence, search-as-you-filter, and free text only as an "Invite by identity or ID" escape hatch. Surface resolution progress ("Looking up anna@glue.one…") and typed errors (not found / not registered / ambiguous / offline).
5. Cap and search the **Cluster Sharing** list — it currently renders one `ShareWithField` per cluster for *all* clusters ([Sidebar.tsx:1994](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1994)), most of them unnamed, which is unusable past ~20 people.

### UX-04 — Fake progress and blocking overlays during ingest

**Priority: P0 — release gate.**

**Problem.** Two separate honesty problems:

- The ingest overlay ([App.tsx:2201](../../fotos.browser/browser-ui/src/App.tsx#L2201)) takes over the whole viewport. During a large first scan the user cannot browse anything, cannot cancel, and cannot reach settings. There is no cancel or pause for face/semantic passes either.
- The incoming-share modal renders a progress bar whose width is a hardcoded fiction — 18%, 42%, 70% keyed off a status enum ([App.tsx:2646-2650](../../fotos.browser/browser-ui/src/App.tsx#L2646)). It looks like measured progress and is not.

**Proposal.**

1. Make ingest **non-blocking**: render the gallery immediately and stream photos in as they are processed. Demote the overlay to the existing sticky progress strip in `PhotoGrid` — which already exists and is better ([PhotoGrid.tsx:217](../../fotos.ui/src/components/PhotoGrid.tsx#L217)).
2. Add **Pause** and **Cancel** to every long pass (scan, faces, semantic), plus a "resume later" state — model downloads in particular are large and may be on metered connections.
3. Replace fabricated bars with **indeterminate** indicators plus a truthful phase label. Show determinate bars only where `current/total` is real.
4. Collapse the four concurrent progress reporters (overlay, grid strip, sidebar row, marquee) into **one** global status line in the app header, expandable to per-phase detail.

### UX-05 — The infinite marquee

**Priority: P2 — enhancement.**

**Problem.** `SidebarMarquee` scrolls "Image AI: <status>" repeated three times, forever, at 18s/loop, with no pause, no dismiss, and no percentage ([Sidebar.tsx:607-626](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L607)). It animates continuously in the user's peripheral vision during every analysis pass and ignores `prefers-reduced-motion`.

**Proposal.** Delete it. Its information already exists in `SidebarProgress` and the grid strip. If a persistent ambient indicator is wanted, use a static single-line status with a spinner.

### UX-06 — Non-functional and lying controls in shipped settings

**Priority: P0 — release gate.**

**Problem.** `LibraryConfigPanel` renders a "Sources" list hardcoded to `~/Downloads` and `~/Pictures`, both labelled **active** ([Sidebar.tsx:2074-2078](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2074)) — these are not real sources. "Export as HTML" is a styled button with no `onClick` ([Sidebar.tsx:2081](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2081)). `TabBtnIcon` still supports a `'manage'` icon that nothing renders ([Sidebar.tsx:710](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L710)) — residue of a removed third tab.

**Proposal.** Remove the fake Sources list; if multi-source is planned, drive it from `folders` (which is real). Either wire Export as HTML to the `fotos.html` bundle export or remove the button. Delete the dead `'manage'` branch.

### UX-07 — Contrast and target sizes below usable floors

**Priority: P0 — release gate.**

**Problem.** The interface is built almost entirely from `text-[11px]`, `text-[10px]`, and in the identity panel `text-[9px]` ([FotosSettings.tsx:850, 860, 866, 969](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L850)), coloured `text-white/25`–`text-white/30` on `#0d0d0d`. White at 25–30 % alpha on that background lands near 3.1–3.6:1 — below the 4.5:1 AA threshold for body text at these sizes. Explanatory copy (the text that carries the meaning of every toggle) is consistently the *least* legible text on screen.

Tap targets: destructive trash icons are `h-3 w-3` inside rows with no padded hit area ([Sidebar.tsx:1504](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1504), [1614](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1614), [2152](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2152)) — 12px targets for irreversible actions, against a `--touch-target-min: 44px` the stylesheet itself declares ([index.css:38](../../fotos.browser/browser-ui/src/index.css#L38)).

**Proposal.**

1. Establish and enforce a type scale: body 13px, secondary 12px, minimum 12px anywhere. Retire 9px and 10px entirely.
2. Raise minimum text opacity to `white/55` for body copy, `white/40` for tertiary metadata. Verify with an automated contrast check in CI.
3. Every interactive control gets a ≥44×44 hit area (padding, not icon size). Icon-only destructive buttons need `aria-label` + tooltip, which most currently have via `title` but not `aria-label`.

### UX-08 — Accessibility defects that block keyboard and AT users

**Priority: P0 — release gate.**

**Problem.**

- Interactive-inside-interactive: `PhotoCard` is a `<button>` containing a `role="checkbox"` span ([PhotoGrid.tsx:368, 403](../../fotos.ui/src/components/PhotoGrid.tsx#L368)). `ClusterBrowseRow`, `CollectionRow`, `SimilarFaceRow`, and `ClusterCard` are `role="button"` divs containing real `<button>`s and `<input type="checkbox">`.
- `ContextMenu` has no `role="menu"`, no focus move on open, no arrow-key navigation, and no focus restore on close ([ContextMenu.tsx:83](../../fotos.browser/browser-ui/src/components/ContextMenu.tsx#L83)) — it is unreachable by keyboard at all, since there is no keyboard trigger for it.
- `Lightbox` is a full-screen overlay with no `role="dialog"`, no `aria-modal`, and no focus trap — unlike `ConfirmModal`, which does all three correctly ([ConfirmModal.tsx](../../fotos.browser/browser-ui/src/components/ConfirmModal.tsx)).
- `focus:outline-none` is applied to most inputs with only a border-colour change as replacement ([Sidebar.tsx:1061, 1110](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1061), and throughout) — insufficient focus indication.
- A rich keyboard model exists (`f`, `1`, `+`, `-`, `r`, `l`, `h`, `v`, `i`, Delete in the lightbox; arrows, Enter, `x`, space, Escape in the grid) and is documented nowhere in the UI.

**Proposal.**

1. Restructure rows: the row is a `<div>` with a single primary `<button>`/link filling the clickable region, and sibling controls outside it. No nested interactives.
2. Give `ContextMenu` proper menu semantics, focus-on-open, arrow/Home/End navigation, Escape-to-close-with-focus-restore, and a keyboard trigger (`Shift+F10` / context-menu key, or `.` on the focused item).
3. Make `Lightbox` a proper modal dialog with a focus trap and focus restore to the originating grid cell.
4. Restore visible focus rings globally (`:focus-visible` ring using `--accent-primary`).
5. Add a `?` keyboard-shortcuts sheet, and show shortcuts in tooltips.

### UX-09 — The bottom-right corner is contested by four different controls

**Priority: P1 — structural.**

**Problem.** Four independent floating controls target the same corner:

| Control | Position | File |
|---|---|---|
| Timeline scrubber FAB | `absolute bottom:16 right:16`, 44px | [TimelineScrubber.tsx:332](../../fotos.browser/browser-ui/src/components/TimelineScrubber.tsx#L332) |
| Sidebar collapse | `fixed bottom-6 right-4`, 40px | [Sidebar.tsx:594](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L594) |
| Sidebar expand (when collapsed) | `fixed bottom-[4.5rem] right-4` | [Sidebar.tsx:434](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L434) |
| Lightbox fullscreen / exit / back | `fixed bottom-6 right-4` and `right-[4.5rem]` | [Lightbox.tsx:722, 562, 571](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L722) |
| UpdatePrompt toast | `fixed bottom-20 left-1/2` | [UpdatePrompt.tsx](../../fotos.browser/browser-ui/src/components/UpdatePrompt.tsx) |

When the sidebar is collapsed the grid extends to the viewport edge, putting the scrubber FAB (bottom 16px / right 16px) and the sidebar expand button (bottom 72px / right 16px) in the same column, 16px apart, both 40–44px circles with near-identical styling — and the collapse button at bottom 24px directly overlaps the scrubber FAB region.

**Proposal.** Define a single **floating-control stack** with reserved lanes:

- Bottom-right lane, bottom-up: contextual FAB (scrubber) → view chrome (fullscreen) → layout chrome (sidebar toggle), each 56px apart, and never more than two visible simultaneously.
- Move the sidebar toggle out of the floating layer entirely — put it in the app header (see UX-10), which is where a layout control belongs.
- Toasts (`UpdatePrompt`, share progress) get their own bottom-centre lane with a shared stacking manager, so they cannot cover the selection action bar (they currently can — both target bottom-centre).

### UX-10 — There is no app header

**Priority: P1 — structural.**

**Problem.** `GalleryBreadcrumbs` only renders when a filter or detail view is active (`hasGalleryDetail`, [App.tsx:501, 1445](../../fotos.browser/browser-ui/src/App.tsx#L501)). In the default library view the main pane has **no chrome at all** — no library name, no photo count, no search, no mode switch, no actions. All of that is in a 256px sidebar which can be collapsed away entirely. The folder name appears only in a 11px sidebar row ([Sidebar.tsx:727](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L727)).

**Proposal.** Add a persistent header to the main pane:

```
[Folder ▾ Summer 2025]   Photos | People      🔍 Search…      [⋯]  [👤 anna]  [☰]
   ↳ breadcrumb trail appears as a second line when filtered
```

- Folder switcher (replaces the sidebar Folders list for switching; the list stays in settings for management).
- **Photos / People segmented control** — this is a primary view mode and currently hides in the sidebar ([Sidebar.tsx:978](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L978)).
- **Search moves to the header.** It is the single most-used control and currently sits below the Collections builder in a collapsible sidebar.
- Identity chip showing auth state, replacing the need to dig into Settings → fotos id to know whether you are signed in.
- Sidebar toggle.

This lets the sidebar shrink to what it is good at — filters and facets — and makes collapsing it lossless.

### UX-11 — Sidebar is six features in one 256px column

**Priority: P1 — structural.**

**Problem.** `SidebarProps` has 80+ props ([Sidebar.tsx:18-122](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L18)) because the sidebar owns browsing, faceting, collections, folder management, three sharing scopes, identity, storage, device settings, history, and an LLM audit tool. Consequences the user feels:

- **Sharing lives under "Browse."** `LibrarySharingPanel` renders inside the Browse tab ([Sidebar.tsx:365](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L365)), so managing who can see your photos is a browsing activity, while "Ingestion" and "Export" are settings.
- Desktop has no visible tab labels — `SidebarTabHeader` renders only a gear, and a "Back" chevron appears once you are in settings ([Sidebar.tsx:669](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L669)). Mobile portrait, by contrast, has an explicit two-item bottom bar. Two different navigation models for the same content.
- Settings is a 5-section scroll-spy list inside a 256px column ([Sidebar.tsx:2254](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2254)) containing password-adjacent flows (passkeys, recovery-key derivation with drag-to-reorder photo lists).

**Proposal.** Split by task, not by proximity:

1. **Sidebar = filters and facets only**: search scope, collections list, people list, tags, sort, size, sensitivity. No settings, no sharing, no folder management.
2. **Settings becomes a full-pane view or modal**, not a column: Identity · Library & Storage · Image AI · Sharing · Devices · History · Advanced. Recovery-key setup in particular needs width — it is a 5-step flow with drag-to-reorder image rows currently squeezed into 256px ([FotosSettings.tsx:1276](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L1276)).
3. **Sharing becomes its own view**, reachable from the header `⋯` and from any share affordance, showing all three scopes in one place with a consistent recipient picker.
4. Show explicit, labelled tabs on desktop, matching mobile.
5. Move "AI Audit" (`LLMComparisonPanel`) behind a developer flag — it operates on "the selected photo or first visible photo" ([App.tsx:2524](../../fotos.browser/browser-ui/src/App.tsx#L2524)) and is a diagnostic tool, not a user feature.

### UX-12 — Destructive actions are inconsistently guarded, and nothing is undoable

**Priority: P0 — release gate.**

**Problem.** A confirm dialog exists and is used for photo delete and face-cluster delete ([App.tsx:1144, 513](../../fotos.browser/browser-ui/src/App.tsx#L1144)). It is *not* used for:

| Action | Guard | Location |
|---|---|---|
| Delete collection | none | [Sidebar.tsx:1504](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1504), [2152](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2152), [ContextMenu.tsx:192](../../fotos.browser/browser-ui/src/components/ContextMenu.tsx#L192) |
| Remove managed folder | none | [Sidebar.tsx:1876](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1876) |
| Delete history branch | none | [Sidebar.tsx:2721](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2721) |
| Separate person group | none | [Sidebar.tsx:1198](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1198) |
| Merge clusters | none | [Sidebar.tsx:1159](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1159) |
| Change cluster sensitivity | none | [Sidebar.tsx:1120](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1120) — silently re-clusters, can invalidate manual merges |

There is no undo anywhere in the app. Copy is also ambiguous on the highest-stakes action: *"This will permanently remove the photo from your gallery"* ([App.tsx:1147](../../fotos.browser/browser-ui/src/App.tsx#L1147)) does not tell a reference-mode user whether their original file on disk is being deleted.

**Proposal.**

1. Route **every** destructive action through `ConfirmModal`, or better, through an **undo toast** ("Collection deleted · Undo") for anything reversible. Reserve modals for the genuinely irreversible.
2. Make delete copy state-specific and unambiguous: *"Remove **IMG_4821.jpg** from your fotos library? The original file in `~/Pictures/2025` is not deleted."* vs the ingest-mode wording.
3. Cluster sensitivity: show impact before committing (*"217 → 184 people"*), warn when manual merges would be affected, and offer a reset-to-default.

### UX-13 — Native `prompt()` alongside a purpose-built modal system

**Priority: P1 — structural.**

**Problem.** Renaming a face or a collection from the context menu calls `window.prompt()` ([App.tsx:526, 534](../../fotos.browser/browser-ui/src/App.tsx#L526)) — a browser-chrome dialog, unstyled, unthemeable, blocked in some embedded contexts — while the same rename from a row uses the styled `InlineRenameField`. Two mechanics for one action, one of them breaking out of the app entirely.

**Proposal.** Delete both `prompt()` calls. The context-menu rename should focus the corresponding `InlineRenameField` (scrolling it into view if necessary), or open a small styled prompt modal built on `ConfirmModal`'s primitives.

### UX-14 — First-run puts configuration before value

**Priority: P1 — structural.**

**Problem.** The landing page shows, top to bottom: a giant camera watermark, **two AI opt-in checkboxes with three-line explanations**, an optional authorship checkbox, then the primary CTA, then an "or" divider, then "Connect to server" ([App.tsx:2249-2358](../../fotos.browser/browser-ui/src/App.tsx#L2249)). The user is asked to decide about on-device model downloads and cryptographic authorship claims before they have seen a single photo. "Connect to server" — an advanced/dev path — is presented with equal visual weight to the main action.

**Proposal.**

1. **One action on the landing screen**: *Open your photo folder* (desktop) / *Choose photos* (mobile), with a one-line privacy promise underneath ("Your photos never leave this device").
2. Move face analytics and semantic search to **contextual, just-in-time prompts**: the People tab's empty state offers "Turn on face analytics to find people — downloads ~40 MB once"; the search box offers "Search by meaning?" when a query returns no literal matches. This matches the intent already written into the toggle copy ("Download face models **only when you choose to use** people clustering").
3. Demote "Connect to server" to a text link, and gate it behind a dev/advanced flag if it is not a supported user path.
4. Move Impressum to a persistent footer or the settings About section — it currently exists only on the landing page and disappears once a folder is open ([App.tsx:2359](../../fotos.browser/browser-ui/src/App.tsx#L2359)), which is a legal-visibility problem for a German entity.

### UX-15 — Onboarding fires four coach marks at once

**Priority: P2 — enhancement.**

**Problem.** A single `showOnboarding` boolean drives four separate bright-pink bubbles simultaneously: timeline scrubber ([App.tsx:2435](../../fotos.browser/browser-ui/src/App.tsx#L2435)), mobile nav ([Sidebar.tsx:250](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L250)), sidebar nav ([Sidebar.tsx:959](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L959)), and Image AI ([Sidebar.tsx:2418](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2418)). One ✕ dismisses all of them. The Image AI bubble lives inside a collapsible section on the *other* tab, so it usually renders where no one can see it. They appear the instant photos finish loading — competing for attention with the ingest progress the user is already watching.

**Proposal.** Replace with a **sequenced, dismissible 3-step tour** driven by a step index, each step anchored to a visible target with a spotlight and "Next / Skip (2 of 3)". Trigger on the *second* session, not mid-ingest. Never show a coach mark for a target that is not currently rendered. Persist per-step completion, not a single global flag.

### UX-16 — The timeline scrubber is undiscoverable

**Priority: P2 — enhancement.**

**Problem.** The scrubber's only entry point is a 300 ms press-and-hold on a FAB that is invisible while scrolled to top (`opacity: atTop ? 0 : 1`, [TimelineScrubber.tsx:342](../../fotos.browser/browser-ui/src/components/TimelineScrubber.tsx#L342)) and whose visible affordance is an up-arrow meaning "scroll to top". Nothing communicates that holding it reveals a year-scrubber. The main scroll container also has `hide-scrollbar` ([App.tsx:2371](../../fotos.browser/browser-ui/src/App.tsx#L2371)), so there is no scroll-position feedback of any kind on desktop. The only teaching mechanism is the coach mark from UX-15.

**Proposal.** Show a **persistent, low-contrast year rail** on the right edge whenever the library spans more than one year — hover/touch expands it into the full scrub track. Keep the FAB as scroll-to-top only. Restore a slim custom scrollbar, or let the year rail serve as the position indicator.

### UX-17 — Search is under-specified

**Priority: P1 — structural.**

**Problem.** One input, whose placeholder silently changes meaning by mode ("Search photos…" / "Search people or groups…", [Sidebar.tsx:1107](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1107)). No indication of whether a result came from filename, tag, or semantic embedding. No affordance to enable semantic search from the search box when it is off. No recent searches, no suggestions, no result-count feedback except a breadcrumb crumb reading `Search: <query>`.

**Proposal.** Header search with scope chips (`All · Photos · People · Collections`), typed result grouping, an inline "Search by meaning" toggle that offers to enable the model if disabled, result counts per group, and recent queries. Show *why* a photo matched (matched tag, matched person, semantic similarity score).

### UX-18 — The identity flow reads as a bug

**Priority: P1 — structural.**

**Problem.** Authentication is a two-press, reload-in-the-middle sequence: the button says "Prepare authentication", triggers a `window.location.reload()`, and comes back saying "Authenticate" ([FotosSettings.tsx:746-763](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L746)). The explanation is a paragraph of 11px prose. A tiny 10px note says "fotos will reopen this tab in settings after the reload" ([FotosSettings.tsx:832](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L832)). `handleDisableSync` also hard-reloads ([FotosSettings.tsx:718](../../fotos.browser/browser-ui/src/components/FotosSettings.tsx#L718)), as does the guest-identity path in incoming share ([App.tsx:1015](../../fotos.browser/browser-ui/src/App.tsx#L1015)). An unexplained page reload is the single most alarming thing an app can do during a security flow.

**Proposal.**

1. Present it as an explicit **stepper**: `1 Choose your ID → 2 Prepare device → 3 Verify at glue.one → 4 Save a passkey`, with the current step highlighted and the reload announced *before* it happens ("fotos will reload to finish setting up this device").
2. Show a full-screen "Reloading to finish setup…" state across the reload boundary rather than a silent white flash.
3. Where a reload is technically avoidable, avoid it. Where it is not, own it in the copy.
4. Give the guest-identity path in incoming share ([App.tsx:1002](../../fotos.browser/browser-ui/src/App.tsx#L1002)) a visible explanation — today a user clicking a share link silently gets an account named "Fotos Guest 3f9a21c8" and a page reload.

### UX-19 — Share link output is not shareable

**Priority: P1 — structural.**

**Problem.** The created invite renders a read-only `<input>` with the URL and a `toLocaleString()` expiry ([Sidebar.tsx:1938-1958](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L1938)). No copy button, no QR code, no Web Share invocation. The PIN is generated and returned by `createFotosShareInvite` but **never displayed** — so a security factor exists that the sender cannot communicate.

**Proposal.** A share-link result card: large QR, `Copy link` button with success feedback, `Share…` via Web Share API on capable devices, the PIN displayed as spaced digits with an explanation of what the recipient does with it, relative expiry ("expires in 6 days"), and a `Revoke link` action.

### UX-20 — Single accent colour carries every meaning

**Priority: P2 — enhancement.**

**Problem.** `#e94560` is simultaneously: primary CTA, active tab, selection ring, progress bar, coach-mark background, marquee text, active-cluster border, and the "Create" button — while destructive uses `red-400`. Adjacent hues, so at a glance *Create collection* and *Delete* read the same. There is no success colour (emerald appears once, only for Export) and no warning colour (amber appears once, only in an auth error).

**Proposal.** A semantic colour set on top of the existing tokens in [index.css](../../fotos.browser/browser-ui/src/index.css): `--accent` (primary action only), `--selected` (a distinct hue — blue or cyan — for selection state), `--danger` (clearly separated hue/lightness from accent), `--success`, `--warning`, `--info`. Selection state in particular should never share a colour with the primary CTA.

### UX-21 — Mobile sheet gesture does not follow the finger

**Priority: P2 — enhancement.**

**Problem.** The bottom sheet reads `touchstart` Y and `touchend` Y and jumps between collapsed/half/full on a fixed 50px delta ([Sidebar.tsx:199-220](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L199)) — no `touchmove` tracking, no velocity, no rubber-banding. The sheet does not move under the finger; it teleports on release. The gesture is only recognised on the small handle strip. Landscape swaps to a static 256px rail with no way to resize.

**Proposal.** Implement a standard drag-following sheet: `touchmove` translates the sheet 1:1, release snaps to the nearest detent with velocity bias, backdrop opacity interpolates with position. Allow the drag anywhere in the sheet header. Make the landscape rail resizable, or at minimum wider on tablets.

### UX-22 — Two unrelated history systems

**Priority: P2 — enhancement.**

**Problem.** Browser history (`?photo=` routing, [App.tsx:1104](../../fotos.browser/browser-ui/src/App.tsx#L1104)) and a synced "Breadcrumb History" branch tree in settings ([Sidebar.tsx:2449](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2449)) coexist with no visible relationship. The branch tree exposes ONE-platform concepts directly — eventIds, branches, "Open <folder> to restore this branch" ([Sidebar.tsx:2700](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L2700)) — as a settings feature the user must reason about. It is powerful and almost certainly incomprehensible to a family archivist.

**Proposal.** Reframe as **"Saved places"** or **"Continue where you left off"**: a card list with a thumbnail, human label ("Anna · Summer 2025"), and relative time. Surface the most recent entries in the header/home view where they are useful, not in settings. Keep the branch tree behind an Advanced disclosure for users who want it.

### UX-23 — Folder/library management is scattered

**Priority: P2 — enhancement.**

**Problem.** Folder state appears in four places: the sidebar `FolderHeader` (name only, [Sidebar.tsx:727](../../fotos.browser/browser-ui/src/components/Sidebar.tsx#L727)), the `Folders` collapsible under Browse (list, switch, remove, rescan, reanalyze), the landing CTA, and the storage settings section. Switching folders is a click on a row buried under a collapsible in a tab.

**Proposal.** One **Library** concept, surfaced in the header folder switcher (UX-10), with management (add, remove, rescan, reanalyze, storage mode, quota) consolidated in Settings → Library. Show per-folder health there: photo count, last scan, pending analysis, sidecar-write status.

### UX-24 — Empty states are dead ends

**Priority: P2 — enhancement.**

**Problem.** Empty-state copy exists and is well-differentiated ([App.tsx:2400-2425](../../fotos.browser/browser-ui/src/App.tsx#L2400)) but offers no actions — "This collection is empty · Select photos and add them to this collection from the sidebar" tells the user where to go instead of taking them. The cluster empty state says "Enable face analytics in Settings and scan your gallery" ([ClusterGallery.tsx:118](../../fotos.browser/browser-ui/src/components/ClusterGallery.tsx#L118)) with no button to do either.

**Proposal.** Every empty state gets a primary action button: *Enable face analytics*, *Add photos to this collection*, *Clear filters*, *Try semantic search*.

### UX-25 — Lightbox click-to-navigate conflicts with click-to-zoom

**Priority: P2 — enhancement.**

**Problem.** Clicking the left or right third of the image navigates ([Lightbox.tsx:287-302](../../fotos.browser/browser-ui/src/components/Lightbox.tsx#L287)), double-click toggles fit/1:1, and single-click while zoomed still navigates unless a drag was registered. A user zoomed in on a detail who clicks to reposition gets sent to the next photo. There are no visible prev/next affordances on desktop except in fullscreen, where they are auto-hiding.

**Proposal.** Disable click-to-navigate while zoomed (`scale !== null`). Add persistent, low-contrast prev/next chevrons on hover at the viewport edges. Show a photo counter (`14 / 218`) outside fullscreen too — currently it only exists in the details sidebar and in fullscreen.

---

## 5. Proposed Target IA

```
┌─ Header ────────────────────────────────────────────────────────────┐
│ [Library ▾]  Photos | People       🔍 Search           ⋯   👤   ☰   │
│ Breadcrumb / active filters                          218 photos     │
└─────────────────────────────────────────────────────────────────────┘
┌─ Facets (collapsible) ─┬─ Main pane ───────────────────────────────┐
│ Collections            │  Grid / People / Lightbox                 │
│ People                 │                                           │
│ Tags                   │           ┌─ Selection action bar ─┐      │
│ Date range             │           │ 12 selected · actions  │      │
│ Sort / Size            │           └────────────────────────┘      │
└────────────────────────┴───────────────────────────────────────────┘
  Status line (ingest/analysis) ─── toast lane ─── floating FAB lane

Full-pane views (not sidebar):
  Settings → Identity · Library · Image AI · Devices · History · Advanced
  Sharing  → Gallery · Collections · People · Links · Received
```

## 6. Delivery Mapping

Implementation is split into bounded epics in the [UI delivery plan](./ui/README.md):

| Epic | Findings | Outcome |
|---|---|---|
| [Trustworthy operations](./ui/trustworthy-operations.epic.md) | UX-04–08, UX-12–13 | Remove false state and dead controls; make destructive and modal interactions safe and accessible. |
| [Unified selection](./ui/selection.epic.md) | UX-01–02 | Define one interaction contract and one authoritative action surface without assuming that heterogeneous selections share one storage shape. |
| [App shell and navigation](./ui/app-shell.epic.md) | UX-09–11, UX-14, UX-17–18, UX-23 | Introduce persistent orientation and separate browsing, settings, sharing, and advanced tasks. |
| [Explicit sharing](./ui/sharing.epic.md) | UX-03, UX-19 | Make access changes staged, reviewable, visible, and honest about revocation. |

UX-15–16 and UX-20–25 remain backlog findings until the four core epics and their
decision gates are resolved. Accessibility is a cross-cutting release constraint,
not a late delivery phase.

## 7. Product-Level Release Constraints

- No user-facing control is non-functional or displays fabricated data.
- Exactly one selection model and one selection action bar across photos, people, and collections.
- Every destructive action is either undoable via toast or confirmed via modal, with copy that states exactly what is destroyed.
- No sharing grant is issued without an explicit confirm step naming scope, recipient, and item count; share state is visible on the shared object.
- All body text ≥12px at ≥4.5:1 contrast; all interactive targets ≥44×44.
- Full keyboard operability of grid, lightbox, context menu, and all dialogs, with visible focus and a discoverable shortcut sheet.
- The gallery prioritizes usable browsing during ingest and analysis. Pause and cancel
  behavior is required only after technical discovery identifies safe interruption
  points and restart semantics for each phase.
- No unexplained page reload.

## 8. Product Decision Gates

These questions block affected epic scope. They must be recorded as product decisions,
not silently answered during implementation.

1. Is `Connect to server` (headless source, F8) a supported user path or a development affordance? It shapes the entire landing page.
2. Should the mobile surface (`faceEnrichment: 'remote'`, no sidecars per [gallery-intake.ts:251](../../fotos.core/src/gallery-intake.ts#L251)) show a distinct, simplified UI rather than the same sidebar in a sheet?
3. **Resolved — [D-03](./ui/decisions/D-03-sharing-revocation.md):** removal writes a
   newer sharing-certificate revocation version, stops future access and updates, and
   does not remotely delete content already synchronized or saved by the recipient.
4. Is "Breadcrumb History" a user feature or a platform demo? Its complexity and placement suggest the latter.
5. Should `Export as HTML` produce a `fotos.html` bundle, and is that a v1 commitment?
6. Is the `LLMComparisonPanel` intended to ship to end users at all?

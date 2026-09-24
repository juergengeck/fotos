# Fotos Integrated QA Protocol

Status: Implemented in the browser development server  
Owner: fotos product and engineering  
Last updated: 2026-09-22
Related: [PRD](./PRD.md), [UI flow inventory](./ui.prd.md), [UI delivery plan](./ui/README.md),
[Flow documents](../flows/README.md)

## Goal

Every documented product flow has a named executable evidence owner. The runner is
part of fotos rather than a shell checklist: it owns run state, step state, stop,
logs, timing, coverage validation, and the aggregate report.

The runner follows the Flexibel integrated-runner pattern:

1. Product-owned endpoint and dashboard.
2. Explicit protocol probes registered with `@refinio/qa.core`.
3. Real browser contexts for user-visible behavior.
4. Product-state assertions at model/debug projection boundaries.
5. Real multi-instance processes for identity, pairing, sync, and revocation.
6. One report containing outcomes, timings, evidence, and failure logs.

## Profiles

### UI protocol

Open the dev app, choose **Settings → QA runner → Run UI protocol**. The runner
launches isolated desktop and mobile browser contexts, installs an OPFS-backed
directory picker with deterministic photo fixtures, and drives:

- cold start, legal notice, and intake;
- gallery projection, search, sort, Photos/People switching, and navigation;
- decoded lightbox images, applied rotation/flip, and previous/next navigation;
- selection, collection creation, and photo context actions;
- sharing and identity/settings surfaces;
- desktop control-pane collapse/restore;
- library and saved-collection restoration after a page reload;
- mobile intake and bottom-sheet tab/collapse behavior.

The same browser protocol can target an already-running dev server from the package:

```bash
FOTOS_QA_URL=http://127.0.0.1:5188/ npm run test:integration:fotos-ui
```

### Full protocol

Choose **Run full protocol** for release evidence. It runs the UI protocol and then:

1. UI and domain contract tests.
2. Bilateral named-identity live sync against an ephemeral headless/comm-server
   stack, followed by offline revocation, reconnect, signed
   revocation projection, and denial of later content.
3. Ad-hoc gallery invitation through the sender's share/copy controls, mobile PIN
   acceptance through the recipient's dialog, CHUM transfer, decoded image viewing,
   and reopening both devices. Recipient reopening closes new WebSocket connections
   so the photo must be restored from its stored share manifest. The named-identity
   protocol owns revocation evidence.

The ad-hoc journey must reach a usable photo through the normal product connection
path. It does not force a diagnostic route-key connection to complete delivery.
Pairing success and an imported metadata object are intermediate checkpoints;
neither substitutes for a rendered image and successful reopening.

### Filer/Fotos cross-application protocol

The four-instance protocol that proves durable collection sharing into the native
Filer lives with its owner in
[`../one/packages/refinio.api/src/filer/qa/FilerTestRunnerPlan.ts`](../../../one/packages/refinio.api/src/filer/qa/FilerTestRunnerPlan.ts).
Alice and Charlie are Fotos browser actors, Bob is the Filer runtime. The steps are:

1. verify the exact Fotos browser actors;
2. register all identities with Glue;
3. pair Bob and Charlie with Alice without sharing content;
4. import two photos and collect only the first;
5. share the collection with Bob and compare exact bytes;
6. add the second member and verify live propagation;
7. remove the first member and verify it becomes unreadable;
8. restart Filer offline and verify persisted files;
9. reconnect and keep the same projection;
10. revoke Bob and verify the folder disappears;
11. reload Alice, re-grant Bob, and verify Bob recovers the same scope;
12. optionally run qa.core diagnostics.

Charlie must stay unauthorized after every content step. Fotos drives this protocol
only through the QA operation API below; it has no private test path into the app.

This protocol runs from the Filer QA runner, not from the Fotos **Run full
protocol** profile, and the release gate below does not require it yet. It is the
only automated evidence for collection-scope sharing, member changes, and sender
reload.

### QA operation API (development server only)

`vite-plugin-fotos-api.ts` exposes `POST /api/fotos-qa/<method>` and forwards each
call over the Vite HMR channel to the browser client named by its `clientId`.
`fotosQaOperation.ts` owns the methods: identity preparation, registration, and
verified reload; photo fixture import; collection creation, membership, recipients,
and revocation; pairing invitation creation and acceptance; received-share
snapshots and waits; and `getDiagnostics`. Operations resolve only after the app
state projection shows the requested result, not when the call returns.

For multi-actor runs, start each actor with `npm run dev:qa -- <port>`. That server
disables file watching, so a workspace build started by another actor cannot reload
an actor mid-protocol. Restart it after changing code.

`waitForAppReady` reports ready only when the model is initialized, persisted source
restoration has finished, and every stored collection member is present in the
gallery. A collection that references a photo no longer in any managed folder
therefore keeps an actor not ready until the wait times out.

`getDiagnostics` includes peer-connection and CHUM traces plus
`fotosSharePublication.spans`, the timed phases of the most recent scope commits
([Flow 01](../flows/01-publish-scope-access.md#diagnostics)).

The network protocols own their ephemeral ports, storage, processes, and cleanup.
They exercise product builds and browser role contexts, not mocked transports.

## Coverage contract

`tests/integration/fotos-flow-coverage.mjs` maps every `F<n>` row in
`docs/product/ui.prd.md` to one or more evidence classes:

- `browser-ui` for visible and interactive behavior;
- `unit-contract` for deterministic state transitions and platform capability
  boundaries such as authentication continuation, recovery derivation, PWA update,
  and native-share gating;
- `multi-instance-integration` for identity, certificates, pairing, CHUM sync,
  invitation, and revocation.

Coverage is composite. A visible pass does not replace a protocol assertion, and a
unit pass does not replace browser operability. Adding, renumbering, or removing a
flow requires updating both the inventory and its executable owner; otherwise the
coverage preflight fails.

The ID mapping is an ownership check, not proof that every behavior within a mapped
range was executed. Use the report's individual assertions to determine which
outcomes passed. In particular, real model execution, OS permissions, passkeys, and
recovery are not proven by finding their controls in a browser viewport.

## Reports and failure artifacts

Aggregate reports are written to:

```text
fotos.browser/browser-ui/tests/integration/reports/fotos-<profile>-protocol-<timestamp>.md
```

The seeded UI suite writes JSON evidence and failure screenshots beside the run.
The existing multi-instance suites retain their detailed JSON snapshots and browser
screenshots and surface their stage timings in the aggregate runner log.

The Settings dashboard receives server state over an event stream; it does not infer
completion from log text or poll browser state. Stop terminates the active process
tree and records the protocol as stopped.

## Release gate

A release candidate requires:

- `106/106` (or the current inventory total) mapped with no stale IDs;
- no failed qa.core probes in the full profile;
- no skipped multi-instance protocol step;
- typecheck and production build passing;
- a manual installed-PWA smoke pass for browser/OS permission surfaces that cannot
  be exercised reliably in a headless browser, including install UI, OS share target,
  platform passkey UI, and native export/share sheets.

The manual platform pass supplements the automated capability and state-transition
evidence; it is not a substitute for the integrated protocol.

## Starter journey validation — 2026-09-05

Validated the current browser workspace with:

- `npm test`: 155 tests passed across 38 files.
- `npm run typecheck`: passed.
- `npm run test:integration:fotos-ui`: all 10 desktop/mobile steps passed,
  including decoded image transforms/navigation and saved-collection reopening.
- `npm run test:integration:fotos-adhoc-gallery-share`: passed against a production
  browser build and ephemeral communication/headless services. The sender created
  and copied the invitation through the UI. The mobile recipient entered its PIN,
  received the photo through the normal connection owner, reached the ready state,
  and opened a decoded image. Both galleries survived reload; the recipient kept
  its identity and restored the photo with new WebSocket connections blocked.

This validates the starter journey. It does not constitute a full release pass:
the named-identity revocation protocol and manual installed-PWA checks were not
rerun as part of this change. Sender identity setup and local photo fixtures use
the integration harness; native passkey and directory-picker dialogs are not
covered by these runs. The recipient reload retained HTTP access to the app shell,
so it proves restoration without peer transfer, not a fully offline PWA launch.

## Flow documentation review — 2026-09-22

Reviewed the durable sharing and QA changes against the new
[flow documents](../flows/README.md) and extended the contracts they cite:
signing failure leaves scope access unchanged, a refresh queued ahead of a
recipient change is dropped at the queue head, the first refresh after a reload
becomes the desired state, and the recipient projection rejects mismatched
certificate/chain scopes, incomplete revocations, and unavailable active manifests.

- `npm test` in `fotos.browser/browser-ui`: 46 files, 220 tests passed after the
  fixes for display-name grant expansion, invite expiry, concurrent invitation
  grants, and sync completion-check cost.
- `npm run typecheck` in `fotos.browser/browser-ui`: passed.
- `npm test` in `fotos.core`: 128 tests passed.
- `node --test test/*.mjs` in `fotos.browser` (App Book contract): passed. It now
  runs the unit evidence bound to the publish and receive journeys.
- `npm run test:integration:fotos-ui` against `npm run dev:qa -- 5188`: all 10
  desktop/mobile steps passed before and after those fixes, after repointing the stale `@vger/vger.glue` and
  `@refinio/recovery.core` aliases in `vite.config.ts`, `vitest.config.ts`, and
  `tsconfig.json` from `../vger/packages` to `../one/packages` (removed from
  `../vger` by commit `d71b43dc9`).

Not run: the multi-instance protocols and the Filer/Fotos protocol.

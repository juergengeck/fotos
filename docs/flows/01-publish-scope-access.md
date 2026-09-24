# Flow 01 — Publish or Change Scope Access

Status: Implemented (browser publisher)
Last updated: 2026-09-22
Realizes: F74 gallery, F75 collection, F76 person/cluster, F79 background refresh
Decision: [D-03 sharing revocation](../product/ui/decisions/D-03-sharing-revocation.md)

**Actors:** Publisher (browser with a prepared fotos publication identity).
**Preconditions:** A publication identity exists, the scope has at least one
locally owned photo, and every recipient is a known Person ID.

A scope is one `gallery:main`, `collection:<id>`, or `person:<clusterId>`. Each
issuer–scope pair has one `FotosShareManifest` data root, and each
issuer–recipient–scope relation has one `FotosShareCertificate` with a stable
identity whose versions move between `active` and `revoked`.

## Entry points

| Entry | Intent | Review step |
|---|---|---|
| Sharing view pickers (`handleGalleryShareChange`, `handleCollectionShareChange`, `handleClusterShareChange`) | `assignment` | Review modal naming scope, photo count, added and removed recipients, and the D-03 removal copy |
| Pairing success for a pending gallery invite token ([Flow 03](03-gallery-invitation.md)) | `assignment`, built on the latest requested recipients | None; accepting the sender's invitation is the consent step |
| Background scope refresh when content, collections, or clusters change | `refresh` | None; recipients are unchanged by definition |
| `fotos-qa.setCollectionRecipients` / `revokeRecipient` (development server only) | `assignment` | None; QA actor API |

All four call `commitShareAssignment` in
[App.tsx](../../fotos.browser/browser-ui/src/App.tsx), so they share one
publication path.

## Steps

1. **Resolve grant targets.** Each selected Person ID expands to the other Person
   IDs of the same approved identity (`resolveShareGrantPersonIds`), for example a
   live publication identity plus the same person's saved contact. An identity is
   approved when the user approved it (a contact, whose identity is its Person
   email and therefore bound to its Person ID) or when Glue certified it (the
   registrar's `SubscriptionCertificate`). Self-advertised display names and
   self-signed `GlueProfileCredential` names carry neither kind of trust and never
   expand a grant. See *Gaps* for where the code still differs.
2. **Fingerprint the desired state.** The fingerprint is issuer + sorted recipients +
   sorted content hashes.
3. **Enter the per-scope commit queue** (`FotosShareCommitCoordinator`, in memory,
   one instance per App):
   - Commits for one scope run strictly in call order; different scopes run
     independently.
   - A request whose fingerprint equals the last *queued* fingerprint joins that
     commit instead of publishing twice. A fingerprint repeated after a different
     queued one is a new commit, so the last requested state wins.
   - An `assignment` records the desired recipients immediately. A `refresh` whose
     recipients differ from the desired recipients is dropped, both when it is
     requested and again when it reaches the queue head. A background refresh built
     from stale React state therefore cannot restore a recipient that an explicit
     assignment just removed.
   - The predecessor passed to the certificate step is the last recipient set
     committed by this runtime, not the caller's snapshot. After a reload, the
     persisted assignment is the predecessor.
   - The queue also records the caller's unexpanded requested recipients.
     `getRequestedPersonIds` returns them while this runtime has a pending or
     committed request, so the pairing-success handler adds its recipient to the
     latest requested set instead of a render snapshot. Two invitations accepted
     during one commit therefore both keep access.
   - A failed assignment resets the desired state to the last committed recipients,
     or back to persisted state if nothing was committed in this runtime, so later
     refreshes continue.
4. **Skip already published state.** If this runtime has already committed the
   same fingerprint for the scope, the operation returns without writes.
5. **Publish the scope's photos** (`selected-photo-sync`).
   `ensureSyncedToOneCore(contentHashes)` publishes only the scope's photos. Batches
   are serialized process-wide, and each batch reads and indexes this device's
   device and media books once. A photo counts as published only when its
   `FotosEntry` metadata, a verified original variant with a present BLOB, the
   current device's source/source-entry objects and locators, both device and media
   books, the requested authenticity attestation, the manifest membership, and the
   thumbnail reference a republish would store (none, if the thumbnail cannot be
   read) are all present. Any missing part republishes the photo. Global manifest
   membership is written last.
6. **Resolve entries** (`manifest-resolution`). Every content hash must map to a
   manifest entry; otherwise the commit fails with the number of unprepared photos.
7. **Commit certificates and access** (`commitFotosShareScope`). The order below is
   a D-03 security property:
   1. `scope-closure`: build the next manifest from the entries and their child
      objects.
   2. `scope-root-load-or-create`: load the current manifest version, or store the
      first one so access can be attached to it.
   3. For each removed recipient: `certificate-status-check`, then a new `revoked`
      certificate version is stored (`certificate-store`), signed with a detached
      signature (`certificate-sign`), given retained `IdAccess` for the recipient on
      its chain (`certificate-chain-access`), and published as a
      `FotosShareCertificateChain` version (`certificate-chain-store`).
   4. The same sequence runs for each added recipient with an `active` version.
      A recipient whose current chain-backed certificate already has the target
      status is skipped, so reload migration does not mint duplicate versions.
   5. `manifest-access-replace`: `REPLACE` access on the manifest identity and on
      the current manifest version, limited to the committed recipients.
   6. `manifest-store`: store the new manifest version only if it differs. Because
      access was already replaced, a removed recipient never receives this version.
8. **Record local state.** The scope fingerprint is recorded as committed, active
   transitions are recorded as grants in the share controller, and the UI
   assignment is persisted by the caller's `persist()`. A failure at any earlier
   step skips `persist()`, so the UI keeps the previous committed recipients.

## Failure semantics

- A failure before step 7.5 leaves recipient access unchanged. A revocation whose
  certificate cannot be signed or published does not remove access, so the retained
  control path never loses the evidence it must deliver.
- Certificates published before a later failure stay published. Retrying the same
  assignment is idempotent because of the status check in 7.3/7.4.
- Only the scope's photos are published before a commit. Unrelated dirty photos are
  not published as part of it, but the commit waits behind any sync batch already
  running, because batches are serialized process-wide.

## Diagnostics

Every phase in steps 5–7 records a span with scope kind/id, timing, and outcome
(`fotosShareTrace.ts`, bounded to 100 spans, no content or recipient data). The
spans are exposed as `fotosSharePublication.spans` in `fotos-qa.getDiagnostics`.

## Verification points

- Staged picker edits issue no grant before the review modal is confirmed.
- Revocation stores and publishes a newer certificate version before access
  replacement; a signing failure leaves access untouched.
- Re-adding a recipient creates a newer `active` version under the same identity.
- Concurrent requests for one fingerprint publish once; changed fingerprints publish
  in order; a stale refresh never restores a removed recipient.
- A photo is republished when any part of its per-device publication is missing,
  including an interrupted earlier run.

## Runner coverage

- `fotosShareCommitCoordinator.test.ts`: coalescing, ordering, independent scopes,
  failure recovery, stale-refresh suppression at request time and at queue head, the
  first refresh after reload, and concurrent additions built on the latest requested
  recipients.
- `fotosShareCertificates.test.ts`: revocation-before-access ordering, phase trace
  order, signing-failure fail-closed behavior, renewal identity, reload migration,
  and stale manifest closure migration.
- `fotos-sync.test.ts`: durable completion check, repair of interrupted publication,
  per-signer authenticity, missing original BLOB, thumbnail and source identity
  changes, an unreadable thumbnail that must not force republication, one book read
  per batch, retry after failure, and serialized batches.
- `shareGrantTargets.test.ts`: expansion to the same identity's saved contact, and
  no expansion to peers whose display name merely matches.
- `fotosShareTrace.test.ts`: bounded, content-free diagnostics.
- Named-identity protocol (`test:integration:fotos-id-share`): gallery share, offline
  revocation, and a post-revocation photo that stays unavailable.
- Filer/Fotos protocol in
  [`FilerTestRunnerPlan.ts`](../../../one/packages/refinio.api/src/filer/qa/FilerTestRunnerPlan.ts):
  step 5 activation, steps 6–7 member add/remove, step 10 revocation, and step 11
  re-grant after the publisher reloads.

## Gaps

- **Grant expansion does not use Glue trust yet.** Candidates are limited to
  contacts, so a Glue-certified peer with the same identity is not added. The
  selected peer's name-derived identity is accepted when `hasVerifiedIdentity` is
  true, but that flag also counts self-signed profile credentials; it should
  require Glue certification. The presence service in `../one/packages/vger.glue`
  keeps the registrar-certified name only in private maps, so Fotos needs an
  accessor for it before both halves can be fixed.
- **The picker's "Verified identity" label has the same gap.** It shows
  `hasVerifiedIdentity`, so a self-signed credential reads as verified. The label
  the user approves against should mean user or Glue trust.
- **The review modal names only the selected recipients**, not the saved contacts
  they expand to.
- **The commit queue is per tab.** Two tabs of the same instance can interleave
  commits for one scope. The certificate status check keeps the result idempotent,
  but the last writer determines the recipients.
- **Background refresh is still O(scope size) per content change.** Each changed
  scope re-checks every photo it contains: the entry, variants, source objects,
  locators, and the thumbnail file. The books are read once per batch, but a gallery
  scope still re-checks every photo when one photo is added.
- No automated test covers person-scope sharing end to end.

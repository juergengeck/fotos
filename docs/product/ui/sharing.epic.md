# Epic: Explicit Sharing

Status: Implemented
Owner: fotos product and engineering
Last updated: 2026-09-22
Evidence: [UX-03 and UX-19](../ui.prd.md#ux-03--sharing-grants-are-silent-immediate-and-unreviewable)
Decision: [D-03 sharing revocation](./decisions/D-03-sharing-revocation.md)
Flows: [01 publish scope access](../../flows/01-publish-scope-access.md),
[02 receive a shared scope](../../flows/02-receive-shared-scope.md),
[03 gallery invitation](../../flows/03-gallery-invitation.md)

## Outcome

Sharing is a deliberate, reviewable access change. Users can see what is shared, with
whom, and at what scope; recipient removal describes only revocation behavior the
system can actually enforce. Direct trusted sharing remains the primary model, with
invite links as an explicit secondary path rather than a public-link default.

## User Jobs

- Choose known recipients and review the exact photo scope before access is granted.
- See existing access from the gallery, collection, or person being shared.
- Remove future access with an accurate explanation of already synchronized copies.
- Send a usable invite through copy, Web Share, QR, or PIN where supported.
- Understand identity-resolution failures and how to correct them.

## Sharing Transaction

1. User chooses a gallery, collection, person/cluster, or explicit selected scope.
2. Recipient picker stages additions and removals without issuing grants.
3. Review names the scope, item count where measurable, recipient identity, original
   download capability, and relevant online/verification state.
4. One explicit commit applies the access-assignment change and grants new peers.
5. Success state remains visible on the shared object and in the Sharing view.
6. Removal publishes a causally newer revocation version of the sharing certificate
   under the same stable certificate identity. The revocation removes the recipient
   from derived access to the affected fotos roots and stops future synchronization.
7. The retained trust/control relationship delivers the revocation evidence; fotos
   must not remove the only delivery path before the new certificate version can be
   observed by the recipient.
8. Previously synchronized or separately saved files remain on the recipient's device.
   Revocation UI never implies remote deletion.

## Recipient Picker

- List-first presentation of known trusted contacts, with search/filter.
- Verified identity and presence are distinct, labeled states.
- Free text is an “Invite by identity or ID” secondary action.
- Resolution exposes working, not found, unregistered, ambiguous, and offline states.
- A staged chip is visually distinct from committed access.
- Large people/cluster lists are searchable and virtualized or paginated as needed;
  the UI does not render an independent recipient field for every cluster.

## Persistent Share State

- The right control pane summary, collection rows, and person/cluster rows show a
  shared indicator.
- Activating it opens one “Shared with” view for inspection and change.
- The view distinguishes pending, committed, failed, and removed assignments.
- Item counts are measured from the committed scope and labelled as approximate if the
  backing set can still change during review.

## Invite-Link Result

- Shows a Copy link action with success feedback.
- Uses Web Share where supported and a QR code where it materially helps handoff.
- Displays the PIN if the recipient protocol requires it.
- Shows absolute and relative expiry, plus explicit revoke-link behavior.
- Clearly distinguishes an invitation/handshake link from a public album URL.

## In Scope

- Gallery, collection, cluster/person, and selection-driven sharing entry points.
- Recipient discovery/resolution UI, staged changes, review, commit, error, and retry.
- Persistent access indicators and centralized Sharing view.
- Invite-link output and revoke-link action.
- Incoming-share consent copy insofar as it explains identity provisioning and reload.

## Out of Scope

- Pretending to retract already downloaded originals.
- Public social links or anonymous browseable albums.
- Changing CHUM trust semantics solely to match preferred copy without a separate
  protocol decision.
- Redesigning the underlying identity system beyond status and resolution presentation.

## Dependencies and Decisions

- D-03 is decided. Fotos now owns a signed, versioned, scope-specific certificate and
  manifest model supporting independent gallery, collection, and person/cluster
  revocation and recipient-side current-version projection.
- Unified Selection supplies a typed, reviewable scope; it must not pass a silently
  filtered subset.
- App Shell supplies the Sharing view and persistent control-pane/row indicators.
- Protocol owners must confirm PIN use, expiry, link revocation, and whether recipients
  can download originals for each scope.

## Implementation Status

Implemented in the browser and shared core:

- Gallery, collection, and person/cluster assignments are staged and require an
  explicit review commit before access changes.
- Each issuer-recipient-scope relation has a signed, versioned
  `FotosShareCertificate` with a deterministic stable identity and `active` or
  `revoked` lifecycle state.
- Each scope has an independent `FotosShareManifest`; access replacement is limited
  to that scope's exact `FotosEntry` roots.
- Revocation evidence is stored, signed, and published through its retained control
  path before the removed recipient is excluded from the scope root.
- Existing global `FotosManifest` grants are retired after persisted assignments are
  migrated to certificate-backed scopes.
- Removal copy states that future updates stop and already stored photos are not
  deleted.
- Sharing has its own app-shell destination. Trusted contacts are presented list-first
  with separate verified and presence states; identity/ID entry is secondary and
  resolution failures distinguish incomplete IDs from unregistered identities.
- Gallery invite output displays the required PIN, QR code, Copy, Web Share where
  supported, absolute/relative expiry, scope count, and a real revoke action backed by
  `PairingManager.invalidateInvitation()`.
- People-scope sharing is collapsed by default, searchable, and capped at 50 rendered
  matches instead of instantiating every recipient picker in a large library.
- The unified action bar can hand an exact photo/people selection to Sharing by
  materializing it as a named collection scope before any recipient is staged.
- Committed gallery access is visible in the right control pane, and committed
  collection/person access is visible on the corresponding Browse rows; each
  indicator opens the centralized Sharing destination.
- Recipients project only current certificate versions addressed to their local
  identities, verify detached signatures through trusted issuer keys, bind active
  certificates to the exact current manifest, and surface active/revoked/invalid state.
- Fotos configures the ONE reverse maps needed for signature and subject-driven
  certificate discovery; late stale active versions cannot replace a current revocation.
- The centralized Sharing view summarizes outgoing and received scopes and renders
  certificate-backed Received state.
- Every access change for a scope goes through one in-memory commit queue. Commits
  for a scope run in order, identical requests are coalesced, the certificate
  predecessor is the last committed recipient set rather than a UI snapshot, and a
  background refresh can never restore a recipient that an explicit change removed.
- Before a commit, only the scope's photos are published, and a photo counts as
  published only when its entry, verified original, device source, locators, device
  and media books, and requested authenticity attestation are all durable. An
  interrupted earlier publication is repaired rather than trusted.
- Each publication phase is traced (scope, timing, outcome; no content) and exposed
  through the development QA diagnostics.
- The Filer/Fotos protocol shares a collection into the native Filer, propagates
  member additions and removals, survives an offline Filer restart, removes the
  folder on revocation, and restores it after the publisher reloads and re-grants.
- The two-browser identity-share protocol test disables the recipient network before
  removal, commits revocation and a later photo while that recipient is offline, then
  proves on reconnect that the detached signature verifies, the revoked projection wins,
  and the later photo remains unavailable.

## Acceptance Criteria

- Editing staged recipients issues no access grant before explicit commit.
- Review names scope, recipients, and a truthful item count or count limitation.
- Successful sharing is visible without reopening a buried sidebar section.
- Recipient removal stores a newer revocation certificate version and replaces derived
  access for the affected fotos roots before reporting success.
- Post-revocation manifest/content versions are not exported to the removed recipient.
- Removal copy says: “They will no longer receive new photos or updates. Photos already
  stored on their device are not deleted.”
- Resolution failures are typed and actionable.
- Invite output exposes every factor the recipient needs, including PIN when required.
- Sharing transactions are keyboard and screen-reader operable and restore focus.
- No share action silently broadens a selected or collection scope.
- Automated tests prove the boundary between staged changes and grant side effects.

## Validation Scenarios

1. Add, remove, and re-add online, offline, unknown, ambiguous, and unregistered peers.
2. Review gallery, collection, person, and explicit-selection scopes with changing counts.
3. Fail identity resolution, grant commit, link creation, and incoming transfer; retry safely.
4. Revoke before and after a recipient has synchronized content; verify the newer
   certificate version, access replacement, stopped future deltas, retained control
   path, local-copy behavior, and exact UI copy.
5. Complete direct-share and invite-link flows using keyboard only and mobile touch.

## Open Findings (2026-09-22)

Fixed on 2026-09-22:

- Grant expansion no longer adds peers whose display name matches a reviewed
  recipient; only saved contacts with the same explicit identity join the grant.
- The invite link's expiry is the pairing invitation's real lifetime (15 minutes)
  instead of a fixed 24 hours.
- Two invitations accepted during one commit no longer revoke each other.

Still open, tracked in the flow documents:

- Grant expansion and the "Verified identity" label treat self-signed profile
  credentials as trusted and ignore Glue certification; trust should come only from
  the user's approval or from Glue
  ([Flow 01](../../flows/01-publish-scope-access.md#gaps)).
- The invite PIN is a second factor meant to reach the sender separately, inside
  CHUM, before the gallery is granted. Today the sender grants on pairing alone,
  and only the recipient's browser checks the PIN, against a digest in the link
  ([Flow 03](../../flows/03-gallery-invitation.md#security-properties)).
- Revocation removes received photos from the recipient's views automatically.
  Revocation may only request deletion, and automated deletion needs the
  recipient's prior consent
  ([Flow 02](../../flows/02-receive-shared-scope.md#revocation-as-the-recipient-sees-it)).

## Success Measures

- Zero grants caused by uncommitted picker edits.
- Share review-to-commit and transfer completion rates without recipient/content telemetry.
- Reduced unresolved recipient-entry failures.
- Zero release-QA cases where revocation copy exceeds protocol guarantees.

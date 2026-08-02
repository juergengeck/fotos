# D-03: Sharing Revocation

Status: Decided
Owner: fotos product and engineering
Decision date: 2026-08-02
Related: [Explicit Sharing epic](../sharing.epic.md), [UI audit](../../ui.prd.md)

## Decision

Removing a recipient from a fotos share publishes a causally newer revocation version
of the sharing certificate under the same stable certificate identity. The current
valid certificate version is the authority for the issuer-recipient sharing relation;
UI assignment arrays and remembered peer sets are projections, not independent access
truths.

Applying the revocation removes that recipient from derived `IdAccess`/`Access` on the
affected fotos roots. This stops export of future manifest, entry, media, and metadata
versions covered by the revoked scope.

Revocation does not remotely delete objects, blobs, exported files, screenshots, or
other copies already stored on the recipient's device. The product must say so plainly.

The recipient's trust/control path remains intact so the new certificate version can
be delivered and projected. Fotos must publish the revocation evidence before removing
access to photo-data roots; it must not remove the only path capable of carrying that
evidence.

Renewal or re-sharing creates a causally newer active certificate version with a new
exact hash. Stale active versions arriving later cannot supersede a newer revocation or
renewal.

## Product Copy

Confirmation:

> Stop sharing **Summer 2025** with **Anna**? They will no longer receive new photos
> or updates. Photos already stored on their device are not deleted.

Success:

> Sharing stopped. Anna will not receive future photos or updates.

Do not use “remove their photos,” “retract downloaded photos,” or equivalent wording.

## Scope Semantics

- Revoking a gallery share removes every scope granted only through that gallery
  certificate relation.
- Revoking one collection or person/cluster scope leaves unrelated active scopes for
  the same recipient intact.
- A certificate's stable identity and scope representation must therefore support
  deterministic independent revocation. Engineering must decide whether the current
  access-certificate context set is sufficient or whether fotos needs a typed
  scope-specific certificate identity.
- When the final active scope is removed, the latest certificate version represents
  full revocation for that issuer-recipient relation.

## Ordering Invariant

The implementation transaction is:

1. Construct and attest the new certificate version.
2. Store it under the existing stable certificate identity.
3. Publish it through the retained trust/control path.
4. Replace derived access on the affected fotos roots, removing the recipient.
5. Feed the new certificate and access state into local projections.
6. Report success only after the authoritative local state reflects revocation.

If delivery is asynchronous because the recipient is offline, the issuer still stops
future export immediately through its local access replacement. The recipient observes
the signed revocation version when the retained control path reconnects.

## Evidence From Flexibel and ONE

Flexibel's current role-certificate lifecycle establishes the pattern:

- [`RoleCertificate` v2](../../../../../one-experimental/packages/trust.core/src/recipes/RoleCertificate.ts#L22)
  has stable identity fields plus `status`, validity bounds, `revokedAt`, and a reason.
- [Flow 12](../../../../../heiner/one.flexibel/docs/flows/12-role-trust-certificate-chain.md#L30)
  specifies revocation as a new signed version of the same stable identity, delivered
  through the retained participant channel; renewal is causally newer and stale active
  evidence cannot overwrite it.
- [`AccessCertificate`](../../../../../one-experimental/packages/trust.abac/src/recipes/AccessCertificate.ts#L1)
  is versioned by a stable id and represents revocation as a newer immediately expired
  version with no effective contexts.
- [ONE access replacement](../../../../../one-experimental/packages/one.core/src/access.ts#L105)
  permits an empty replacement version to revoke previous grants.
- [The CHUM access test](../../../../../one-experimental/packages/one.core/test/src/chum-sync-notification-test.ts#L207)
  verifies that revoked id-root access stops future version deltas.

Relevant shared-repository history:

- `one-experimental@01b456b`: Model role revocation and superseding evidence.
- `one-experimental@ee5bc41`: Move role evidence to detached ONE signatures (v2 recipes).

## Consequences

- Fotos uses `FotosShareCertificate` and `FotosShareManifest` as its
  issuer-recipient-scope lifecycle evidence and scope-specific data root; directly
  mutating UI share arrays is not sufficient authority or audit state.
- Existing global `FotosManifest` grants are migration inputs only. They are replaced
  with certificate-backed scope roots and then retired so they cannot leak later
  gallery versions to a removed recipient.
- Revocation tests must cover stale replay, offline recipients, re-sharing, independent
  scopes, application reload, and proof that future root versions are not exported.
- Remote deletion is intentionally outside the security promise.

## Implementation Status

Issuer-side certificate publication and scope-access replacement are implemented.
Recipient projection discovers signed `FotosShareCertificateChain` transfer roots,
verifies their detached signatures with trusted issuer keys, validates subject/scope
identity, and binds active state to the exact scope manifest. Unit tests enforce
revocation-before-access-removal ordering, stable identity, signature refusal, migration
from pre-chain certificates, and stale active replay handling. The multi-instance
identity-share protocol test takes the recipient network offline before removal, commits
revocation plus a later photo, reconnects the recipient, and proves delivery of the
verified revocation while the later photo remains unavailable. The decision is therefore
protocol-verified for the v1 direct-share path.

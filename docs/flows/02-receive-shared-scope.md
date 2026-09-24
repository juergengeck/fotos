# Flow 02 — Receive a Shared Scope

Status: Implemented (browser recipient, Filer recipient)
Last updated: 2026-09-22
Realizes: F72 CHUM sync of shared content, F73 incoming sync visibility, and the
Received section of the Sharing view
Decision: [D-03 sharing revocation](../product/ui/decisions/D-03-sharing-revocation.md)

**Actors:** Recipient browser (`App.tsx` projection) or recipient Filer runtime
(`SharedFotosFileSystem` mounted by `FilerRuntime` in `../one`).
**Preconditions:** The recipient is paired with the issuer, trusts the issuer's
signing key, and the issuer has run [Flow 01](01-publish-scope-access.md) with the
recipient as an added Person.

## Steps

1. **Transfer.** CHUM delivers the `FotosShareCertificateChain` version (retained
   `IdAccess` for the recipient), its certificate, the detached `Signature`, and,
   for an active scope, the `FotosShareManifest` version and its entry closure.
   Objects can arrive in any order.
2. **Discover.** The recipient lists current chain versions through the
   `FotosShareCertificateChain` reverse map for each of its own Person IDs (owner
   and publication identity). Chains for which this subject is the issuer are
   ignored.
3. **Validate identity bindings.** The chain ID, certificate ID, issuer, subject,
   and scope must all match the deterministic identities built from
   issuer + subject + scope. Any mismatch yields an `invalid` scope with a reason.
4. **Verify the signature.** The `Signature` must sign the exact certificate hash
   with the chain's issuer and verify against trusted keys. The browser refreshes the
   trust cache first, because pairing can import issuer keys after the initial trust
   cache is built.
5. **Project the lifecycle.**
   - `revoked`: requires `revokedAt` and `revocationReason`; the scope projects with
     no entries.
   - `active`: loads the issuer's current manifest for the scope, checks its
     identity binding, and projects its entries.
   - An older active version that arrives late cannot replace a newer revocation,
     because only the current version of each stable identity is projected.
6. **Re-project on change.** The browser re-projects on local versioned-object
   events and CHUM imports of certificate, chain, manifest, and signature objects,
   running at most one projection at a time with one queued follow-up.
   `FilerRuntime` invalidates the `SharedFotosFileSystem` tree on the same object
   types. On trust-relevant changes (Profile, Someone, Leute, trusted keys, person
   rights) it also clears cached signature verifications.
7. **Serve content.** In the browser, active scope entries join the gallery as
   received entries. In Filer, each verified active collection scope becomes a
   read-only folder `/Fotos/<collection>` whose files are the entries' source paths.
   `readFile` fetches the original bytes and returns them only if no invalidation
   happened meanwhile; otherwise it reads again from the rebuilt tree.

## Revocation as the recipient sees it

Revocation stops future updates. It cannot take back what the recipient already
has: it can only ask the recipient to delete it, and the recipient's device may act
on that request automatically only if the recipient consented beforehand.

The current implementation differs. A revoked scope projects with no entries, so
previously received photos disappear from the recipient's gallery and Filer folder,
and Filer reads of them fail. Their ONE objects and BLOBs stay in storage, but the
recipient loses access through the product without having agreed to it, and the
revocation carries no deletion request. See *Gaps*.

## Filer projection cache

`SharedFotosFileSystem` builds one immutable tree per generation and shares it
across concurrent `readDir`/`stat`/`readFile` calls. Invalidation advances the
generation synchronously, so a build started before a revocation is never returned
after it. Signature verification results are cached per signature hash until trust
changes. `dispose()` rejects in-flight and later reads. `getDiagnostics()` reports
build and verification counts and timings.

## Verification points

- Only current certificate versions addressed to the recipient are projected.
- Invalid bindings, missing objects, and untrusted signatures produce `invalid`
  scopes with reasons and never expose entries.
- A revocation committed while the recipient is offline is projected after
  reconnect, and content added after revocation stays unavailable.
- No bytes are returned from a tree that was invalidated during the read.

## Runner coverage

- `fotosReceivedShareProjection.test.ts`: newer revocation over a late active
  version, untrusted signature refusal, no content through an unverified
  certificate, manifest binding and measured count, restoration without an import
  event, outbound chains ignored, certificate/chain scope mismatch, incomplete
  revocation fields, and an unavailable active manifest.
- `shared-fotos-file-system.test.ts` (fotos.core): shared projection builds,
  invalidation, trust-generation verification cache, revocation during build and
  during original hydration, and disposal.
- Named-identity protocol stages `certificate-projection-active`,
  `recipient-offline-before-revocation`, and
  `certificate-projection-revoked-after-reconnect`.
- Filer/Fotos protocol steps 5–11: exact bytes, member add/remove propagation,
  offline Filer restart with persisted files, reconnect, revocation removing the
  folder, the reloaded publisher restoring it, and a third identity (Charlie) that
  stays unauthorized at every step.

## Gaps

- **Revocation removes access automatically without consent.** The projection
  should keep the last entries a recipient received from a revoked scope, marked as
  no longer updating. Removing them should happen only when the issuer requested
  deletion and the recipient consented to automated deletion beforehand; otherwise
  the recipient sees the request and decides. Filer/Fotos protocol step 10 asserts
  the current removal and must change with it.
- The browser projection has no build cache or diagnostics comparable to the Filer
  one. It re-verifies every signature on each change event.
- Person and gallery scopes are not mounted in Filer; only collection scopes are.

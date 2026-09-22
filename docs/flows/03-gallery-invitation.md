# Flow 03 — Gallery Invitation

Status: Implemented (browser sender, browser guest recipient)
Last updated: 2026-09-22
Realizes: F68 create invitation, F12 invitation deep link, F69 recipient opens the
invitation, F70 destination folder, F71 guest identity provisioning, F72 transfer

**Actors:** Sender (browser with a prepared publication identity and an open
gallery); recipient (any browser, with or without a fotos identity).
**Preconditions:** The sender's gallery has at least one locally owned photo.

The invitation is a secondary path to [Flow 01](01-publish-scope-access.md) for a
recipient who is not yet a known contact. It ends in the same certificate-backed
`gallery:main` assignment as a named share.

## Steps

1. **Prepare content.** The sender publishes the gallery's photos and refreshes the
   manifest. If nothing is ready, invitation creation fails.
2. **Create the invitation.** The sender creates a standard pairing invitation for
   its publication identity and wraps it in a fotos invite URL
   (`createFotosShareInvite`). The URL carries only the pairing invitation, sender
   Person ID, gallery name, and expiry — no trace of the PIN, salted or otherwise.
   The link's expiry is the pairing manager's invitation lifetime, measured just
   before the invitation is created, so the link never claims validity the pairing
   token does not have. The four-digit PIN is shown only on the sender's screen
   and kept in sender memory with the token.
3. **Hand off.** The sender copies, Web-Shares, or shows the invitation as a QR code
   and tells the recipient the PIN over a different channel. *Revoke link* invalidates the pairing
   invitation and forgets the pending token and PIN.
4. **Open.** The recipient opens the URL. The app parses the invitation, checks its
   expiry, and asks for the PIN.
5. **Collect the PIN.** The recipient's app checks only the four-digit format.
   There is nothing in the link to check the PIN against. On a desktop surface it
   also asks for a destination folder.
6. **Provision a guest identity if needed.** A recipient without pairing support
   gets a Glue identity `Fotos Guest <random>`, sync is enabled, and the token and
   PIN are stored in `sessionStorage`. The page reloads and resumes acceptance only
   if the stored token matches the invitation.
7. **Pair.** The recipient connects with the invitation and requires the remote
   Person to be the sender named in the invitation. Pairing authenticates both
   Persons and grants nothing.
8. **Prove and grant.** After pairing, the recipient's app stores a
   `FotosSharePinProof` object (token, sender, prover, PIN) with access granted to
   the sender's Person only, so the PIN travels inside CHUM
   (`submitFotosSharePinProof`). The sender's pairing-success handler only records
   who paired with the token; CHUM import listeners pick up the proof, verify it
   against the PIN kept in memory (`decidePinProofOutcome`), and grant the gallery
   — adding the remote Person to the recipients and running Flow 01 with intent
   `assignment` — only on the first valid proof. Five wrong proofs invalidate the
   invitation.
9. **Receive.** The recipient projects the gallery scope as in
   [Flow 02](02-receive-shared-scope.md), shows incoming progress, and renders the
   photos.

## Security properties

- Access is granted by the sender after authenticated pairing, not by possession of
  the URL. The invitation only authorizes the pairing handshake.
- **The PIN is a second factor sent separately, inside CHUM.** The link carries only
  what pairing needs and no trace of the PIN. Pairing authenticates both Persons
  and grants nothing. After pairing, the recipient's app sends proof of the PIN to
  the sender as a `FotosSharePinProof` ONE object over CHUM, readable only by the
  sender, and the sender grants the gallery only after verifying that proof
  against the PIN it holds for the pending invitation. Holding the link without the
  PIN is therefore not enough.
- The sender keeps each pending invitation's PIN in memory, verifies proofs from
  the paired Person, grants on the first valid proof, and invalidates the
  invitation after five wrong proofs.
- The sender's pairing invitation lives only in `PairingManager` memory. It expires
  after the `ConnectionModule` pairing-token lifetime (15 minutes) or when the sender
  reloads, whichever comes first. The pending gallery token and PIN are also in memory only.

## Runner coverage

- `fotosShareInvite.test.ts`: no trace of the PIN in the URL or payload, payload
  round trip, expired invitations reported, the link advertising exactly the
  pairing expiry, and refusal to create a link for an expired pairing.
- `fotosSharePinProof.test.ts`: sender grants on the first valid proof from the
  paired person, ignores proofs without a pending invitation or from anyone else,
  exhausts the invitation after five wrong proofs, and grants sender-only access
  before storing so CHUM observes the proof.
- `share-pin-proof.test.ts` (fotos.core): four-digit PIN format, stable proof id
  per token and prover, and proof verification against token, sender, prover, PIN.
- `fotosShareCommitCoordinator.test.ts`: two invitations accepted during one commit
  both keep access.
- `ShareInviteCard.test.tsx`: sender invitation output.
- `fotosIncomingShareState.test.ts`: incoming share state transitions.
- Ad-hoc gallery invitation protocol (`test:integration:fotos-adhoc-gallery-share`),
  stages: `sender-prepared-identity`, `sender-debug-ready`, `sender-sync-ready`,
  `recipient-debug-ready`, `recipient-ad-hoc-identity`,
  `sender-granted-manifest-ready`, `recipient-imported-photo-object`,
  `recipient-projected-gallery-photo`, `recipient-gallery-dom-photo`, then reload of
  both devices with new WebSocket connections blocked for the recipient.

## Gaps

- A sender reload still ends every outstanding invitation early. The displayed
  expiry cannot show that.
- The guest reload path keeps the PIN in `sessionStorage` until acceptance
  finishes.

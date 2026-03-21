# Fotos id integration with glue.browser

## Goal

Make fotos id the primary identity creation path in glue.browser. Key generation becomes a fallback. Users create their identity on fotos.one where photo-based key derivation happens locally — recovery photos never go online.

## Registration flow

1. User visits glue.one → sees **"Create fotos id"** (primary) and "Generate key" (secondary)
2. "Create fotos id" opens popup to `fotos.one/fotos-id`
3. On fotos.one: user picks photos + date PIN → keypair derived locally via `deriveKeyFromPhotos()`
4. fotos.one creates a self-signed SubscriptionCertificate with the derived public key as `subjectPublicKey`
5. fotos.one POSTs the self-signed cert to glue.one API → server counter-signs, indexes `pk:` and `name:`
6. fotos.one returns identity + counter-signed cert to glue.browser via `postMessage`
7. glue.browser stores credentials in localStorage, same as OneAuth flow today

Recovery: same flow — pick same photos + date → re-derive same key → server re-certifies (new cert version, same identity).

## Key classes

Three distinct key classes with different cardinality:

### Certified identity key (one active per identity)

No structural change. Current model already handles this:
- `pk:{publicKeyHex}` → identity (reverse lookup)
- `name:{identity}` → NameIndexEntry (includes publicKey)
- Certificate versioning handles rekey: new cert version with new `subjectPublicKey`, old cert accessible by contentHash

On rekey/recovery: new self-signed cert with re-derived key → server counter-signs → new `pk:` entry → old `pk:` entry removed. Same identity, new active key.

### Passkeys (many per identity)

Already works. `cred:{identity}` → array of StoredPasskeyCredential. No changes needed.

### Device keys (many per identity)

Change `dk:{identity}` (single object) to `dk:{identity}:{encryptionKeyHex}` (one entry per device key). Benefits: no read-modify-write races, `rehydrateDeviceKeyIndex()` already iterates all `dk:*` entries — just needs prefix match update.

## Post-creation: passkeys and device keys

Once glue.browser has the identity from fotos.one:
- Add a **passkey** — WebAuthn ceremony, stored in `cred:{identity}`. Convenient browser-native login without fotos.one.
- Register a **device key** — instance encryption/signing key at `dk:{identity}:{encryptionKeyHex}`. Enables CHUM sync routing.
- The fotos-derived key remains the **certified identity key** (the authority). Passkeys and device keys are convenience/transport.

Users never manage keys directly. Passkey for daily use, fotos.one for recovery.

## Boundary export (VC mapping)

Only when identity leaves the ONE ecosystem:
- **Exporter**: SubscriptionCertificate → W3C Verifiable Credential. Standalone function, not in the flow.
- **Importer**: VC → self-signed cert for registration on glue.one.
- Not needed for fotos ↔ glue. Exists for future interop only.

ONE recipes are more granular than W3C VCs — mapping out is always clean.

## Changes per package

### glue.browser (vger)
- Registration UI: "Create fotos id" button as primary, demote key generation to fallback
- Popup handler: open `fotos.one/fotos-id`, listen for `postMessage` with identity + cert (same as OneAuth pattern)
- After popup return: store credentials in localStorage, proceed with passkey/device key setup

### glue.one / vger.headless
- Device key storage: `dk:{identity}` → `dk:{identity}:{encryptionKeyHex}`
- `rehydrateDeviceKeyIndex()`: update prefix matching
- No changes to cert or passkey handling

### fotos.browser
- New route: `/fotos-id` — popup target for external apps
- Implements: photo picker + date PIN → `deriveKeyFromPhotos()` → self-signed cert → POST to glue.one API → `postMessage` result back to opener
- Reuses existing fotos id components, wired into popup flow instead of inline settings

### auth.core (vger)
- Extend OneAuth to support fotos id as auth method alongside passkeys, or keep as parallel popup flow

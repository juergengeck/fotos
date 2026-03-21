# Fotos id ↔ glue.browser Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Create fotos id" button to glue.browser's registration flow that opens a popup to fotos.one, where the user creates their identity via photo-based key derivation. Key generation becomes the fallback.

**Architecture:** fotos.one serves a lightweight popup page (`/fotos-id.html`) that runs the photo key derivation flow, creates a self-signed certificate, registers it on glue.one API, and returns identity credentials to glue.browser via postMessage. glue.browser adds a popup client that follows the same pattern as the existing auth popup (`openAuthPopup` in auth-client.ts). Device key storage in vger.headless changes from `dk:{identity}` to `dk:{identity}:{encryptionKeyHex}` to support multiple devices.

**Tech Stack:** React, TypeScript, Vite (multi-page), ONE.core (crypto, certs), postMessage protocol, hash-wasm (Argon2id)

---

### Task 1: Fotos id popup page — HTML entry point and Vite multi-page setup

**Files:**
- Create: `fotos.browser/browser-ui/fotos-id.html`
- Create: `fotos.browser/browser-ui/src/fotos-id-main.tsx`
- Modify: `fotos.browser/browser-ui/vite.config.ts:335-341`

**Step 1: Create the HTML entry point**

Create `fotos.browser/browser-ui/fotos-id.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>fotos.one — Create fotos id</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #111;
      color: #eee;
      min-height: 100vh;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/fotos-id-main.tsx"></script>
</body>
</html>
```

**Step 2: Create the React entry point**

Create `fotos.browser/browser-ui/src/fotos-id-main.tsx`:

```tsx
/**
 * Fotos id popup entry point — lightweight, does NOT boot full fotos model.
 *
 * Only loads ONE.core browser platform (for crypto/key derivation) and renders
 * the FotosIdPopup component which handles the postMessage protocol.
 */

// Polyfills
if (typeof globalThis.setImmediate === 'undefined') {
  (globalThis as any).setImmediate = (fn: (...args: any[]) => void, ...args: any[]) => setTimeout(fn, 0, ...args);
  (globalThis as any).clearImmediate = (id: number) => clearTimeout(id);
}

import ReactDOM from 'react-dom/client';
import { FotosIdPopup } from './FotosIdPopup.js';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<FotosIdPopup />);
}
```

**Step 3: Add multi-page entry to Vite build config**

In `fotos.browser/browser-ui/vite.config.ts`, find the `build.rollupOptions` section (around line 335-341) and add the fotos-id entry. Currently this section looks like:

```ts
    rollupOptions: {
        external: ['ws'],
    },
```

Change to:

```ts
    rollupOptions: {
        input: {
            main: path.resolve(__dirname, 'index.html'),
            'fotos-id': path.resolve(__dirname, 'fotos-id.html'),
        },
        external: ['ws'],
    },
```

**Step 4: Verify dev server serves the page**

Run: `cd fotos.browser/browser-ui && npx vite --port 5188 &`
Visit: `http://localhost:5188/fotos-id.html`
Expected: Page loads with empty div (FotosIdPopup not yet created)

**Step 5: Commit**

```bash
git add fotos.browser/browser-ui/fotos-id.html fotos.browser/browser-ui/src/fotos-id-main.tsx fotos.browser/browser-ui/vite.config.ts
git commit -m "feat(fotos.browser): add fotos-id popup HTML entry and Vite multi-page setup"
```

---

### Task 2: Fotos id popup — ONE.core boot and postMessage protocol

**Files:**
- Create: `fotos.browser/browser-ui/src/FotosIdPopup.tsx`

This component handles the postMessage protocol with the opener (glue.browser) and orchestrates the fotos id creation flow. It follows the same pattern as glue.browser's `AuthPopup.tsx` (`vger/packages/glue.browser/browser-ui/src/AuthPopup.tsx`).

**Step 1: Create FotosIdPopup with postMessage protocol**

Create `fotos.browser/browser-ui/src/FotosIdPopup.tsx`:

```tsx
/**
 * Fotos id popup — handles photo-based identity creation for external apps.
 *
 * Protocol (mirrors AuthPopup.tsx in glue.browser):
 * 1. Popup sends { type: 'fotos-id-ready' } to window.opener
 * 2. Opener sends { type: 'fotos-id-request', requestId } (no extra data needed)
 * 3. Popup walks user through photo key derivation + name entry
 * 4. Popup registers identity on glue.one API (self-signed cert → counter-signed)
 * 5. Popup sends { type: 'fotos-id-result', requestId, success, data?, error? } back
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// Allowed origins that may open this popup
const ALLOWED_ORIGINS = [
  'https://glue.one',
  'https://vger.one',
  'https://fotos.one',
  'https://seller.glue.one',
];

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Dev: localhost and LAN
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  return false;
}

type PopupPhase = 'waiting' | 'setup' | 'creating' | 'done' | 'error';

interface PopupRequest {
  requestId: string;
}

export function FotosIdPopup() {
  const [phase, setPhase] = useState<PopupPhase>('waiting');
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<PopupRequest | null>(null);
  const openerOriginRef = useRef<string>('');

  // Signal readiness to opener
  useEffect(() => {
    if (!window.opener) {
      setPhase('error');
      setError('This page must be opened as a popup');
      return;
    }

    function handleMessage(event: MessageEvent) {
      if (!isOriginAllowed(event.origin)) return;
      if (window.opener && event.source !== window.opener) return;

      const data = event.data;
      if (!data?.requestId) return;

      if (data.type === 'fotos-id-request') {
        openerOriginRef.current = event.origin;
        requestRef.current = { requestId: data.requestId };
        setPhase('setup');
      }
    }

    window.addEventListener('message', handleMessage);
    // Tell opener we're ready
    window.opener.postMessage({ type: 'fotos-id-ready' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Send result back to opener and close
  const sendResult = useCallback((result: { success: boolean; data?: any; error?: string }) => {
    if (!window.opener || !requestRef.current) return;
    window.opener.postMessage(
      { type: 'fotos-id-result', requestId: requestRef.current.requestId, ...result },
      openerOriginRef.current,
    );
    if (result.success) {
      setTimeout(() => window.close(), 500);
    }
  }, []);

  // Handle successful identity creation
  const handleIdentityCreated = useCallback((data: {
    identity: string;
    displayName: string;
    cert: any;
    publicKey: string;
  }) => {
    setPhase('done');
    sendResult({ success: true, data });
  }, [sendResult]);

  // Handle error
  const handleError = useCallback((err: string) => {
    setPhase('error');
    setError(err);
    sendResult({ success: false, error: err });
  }, [sendResult]);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 420, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', textAlign: 'center' }}>
        Create fotos id
      </h2>

      {phase === 'waiting' && (
        <p style={{ color: '#aaa', textAlign: 'center' }}>Connecting...</p>
      )}

      {phase === 'setup' && (
        <FotosIdSetupForm
          onCreated={handleIdentityCreated}
          onError={handleError}
          onPhaseChange={setPhase}
        />
      )}

      {phase === 'creating' && (
        <p style={{ color: '#aaa', textAlign: 'center' }}>Creating identity...</p>
      )}

      {phase === 'done' && (
        <p style={{ color: '#4ade80', textAlign: 'center' }}>Identity created! Closing...</p>
      )}

      {phase === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ff6b6b' }}>{error}</p>
          <button
            onClick={() => window.close()}
            style={{
              marginTop: '1rem', padding: '8px 16px', background: '#333',
              border: 'none', borderRadius: 6, color: '#eee', cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ── Setup form — name + photo selection + PIN + derivation ────────────

// This component will be implemented in Task 3.
// Placeholder for now:
function FotosIdSetupForm(_props: {
  onCreated: (data: { identity: string; displayName: string; cert: any; publicKey: string }) => void;
  onError: (err: string) => void;
  onPhaseChange: (phase: PopupPhase) => void;
}) {
  return <p style={{ color: '#aaa', textAlign: 'center' }}>Setup form placeholder</p>;
}
```

**Step 2: Verify it compiles**

Run: `cd fotos.browser/browser-ui && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add fotos.browser/browser-ui/src/FotosIdPopup.tsx
git commit -m "feat(fotos.browser): fotos id popup with postMessage protocol"
```

---

### Task 3: Fotos id popup — setup form with photo derivation and registration

**Files:**
- Modify: `fotos.browser/browser-ui/src/FotosIdPopup.tsx`

Replace the placeholder `FotosIdSetupForm` with the real implementation. This combines the name entry (from glue.browser's SettingsPanel) with photo key derivation (from FotosSettings' RecoverySecretSection). The key difference: here the derived key becomes the **identity key**, not just a recovery key.

**Step 1: Implement FotosIdSetupForm**

The form needs to:
1. Boot ONE.core (lightweight — just crypto, no full model)
2. Let user pick a display name and check availability
3. Let user pick photos + date PIN
4. Derive keypair from photos via `deriveKeyFromPhotos()`
5. Create a ONE.core identity with the derived key
6. Build a self-signed cert with `buildSelfSignedCert()`
7. POST cert to glue.one API (`/api/registration/registerName`)
8. Return result to popup frame

The boot sequence needs careful attention. The popup needs ONE.core initialized enough to:
- Create a Person with the derived signing key
- Build a self-signed cert
- But NOT the full ModuleRegistry/GlueModule/etc.

Reference code:
- Photo picker + drag reorder: `FotosSettings.tsx:400-560` (RecoverySecretSection)
- Name availability check: `useGlueModel.ts` (`checkNameAvailability`)
- Cert building: `glue.core/src/registration/cert-builder.ts` (`buildSelfSignedCert`)
- Registration: `glue.core/src/registration/index.ts` (`registerNameOnServer`)

**Important:** The standard `buildSelfSignedCert()` reads the person's key from ONE.core's keychain. In the popup, we're deriving the key from photos, so we need to either:
- (a) Import the derived key into ONE.core's keychain first, then call `buildSelfSignedCert()`, or
- (b) Build the cert payload manually with the derived key (bypassing `buildSelfSignedCert()`)

Option (a) is cleaner because it uses the existing cert builder. The popup needs to:
1. Boot ONE.core with `MultiUser.loginOrRegister()` (creates a Person)
2. Import the photo-derived signing key into that Person's keychain
3. Call `buildSelfSignedCert(personIdHash, displayName)`

This is a substantial component. Read these files carefully before implementing:
- `fotos.browser/browser-ui/src/lib/onecore-boot.ts` lines 351-430 (boot sequence — replicate the minimal parts)
- `fotos.browser/browser-ui/src/lib/photo-key-derivation.ts` (full file — the derivation API)
- `fotos.browser/browser-ui/src/components/FotosSettings.tsx` lines 400-640 (RecoverySecretSection UI)
- `vger/packages/glue.core/src/registration/cert-builder.ts` (full file — cert building)
- `vger/packages/glue.core/src/registration/index.ts` lines 37-58 (registerNameOnServer)
- `fotos.browser/browser-ui/src/config.ts` (API_BASE)

**Step 2: Test the popup manually**

Open `http://localhost:5188/fotos-id.html` directly (without opener).
Expected: Shows "This page must be opened as a popup" error.

**Step 3: Commit**

```bash
git add fotos.browser/browser-ui/src/FotosIdPopup.tsx
git commit -m "feat(fotos.browser): fotos id setup form with photo derivation and registration"
```

---

### Task 4: glue.browser — add "Create fotos id" popup client

**Files:**
- Create: `vger/packages/glue.browser/browser-ui/src/lib/fotos-id-client.ts`

This follows the same pattern as `auth-client.ts`'s `openAuthPopup()` function (at `vger/packages/auth.core/src/passkey/auth-client.ts:46-109`).

**Step 1: Create the popup client**

Create `vger/packages/glue.browser/browser-ui/src/lib/fotos-id-client.ts`:

```ts
/**
 * Fotos id popup client — opens a popup to fotos.one/fotos-id.html
 * for photo-based identity creation.
 *
 * Protocol mirrors auth-client.ts:
 * 1. Open popup to fotos.one/fotos-id.html
 * 2. Wait for { type: 'fotos-id-ready' }
 * 3. Send { type: 'fotos-id-request', requestId }
 * 4. Wait for { type: 'fotos-id-result', requestId, success, data?, error? }
 */

const POPUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (key derivation takes time)

function generateRequestId(): string {
  return `fotos-id-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export interface FotosIdResult {
  success: boolean;
  data?: {
    identity: string;
    displayName: string;
    cert: any;
    publicKey: string;
  };
  error?: string;
}

export function getFotosIdPopupUrl(): string {
  // In dev, fotos runs on port 5188; in prod, it's fotos.one
  if (import.meta.env.DEV) {
    return 'http://localhost:5188/fotos-id.html';
  }
  return 'https://fotos.one/fotos-id.html';
}

export function openFotosIdPopup(): Promise<FotosIdResult> {
  const popupUrl = getFotosIdPopupUrl();
  const popupOrigin = new URL(popupUrl).origin;
  const requestId = generateRequestId();
  const popupName = `fotos-id-${requestId}`;

  return new Promise((resolve, reject) => {
    const popup = window.open(popupUrl, popupName, 'popup,width=460,height=620');
    if (!popup) {
      reject(new Error('Popup blocked — please allow popups for this site'));
      return;
    }
    const popupWindow = popup;

    let resolved = false;
    let checkClosedTimer: ReturnType<typeof setInterval> | undefined;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        try { popupWindow.close(); } catch { /* cross-origin close may fail */ }
        reject(new Error('Fotos id popup timed out'));
      }
    }, POPUP_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeout);
      if (checkClosedTimer !== undefined) clearInterval(checkClosedTimer);
      window.removeEventListener('message', handleMessage);
    }

    function handleMessage(event: MessageEvent): void {
      if (event.source !== popupWindow) return;
      if (event.origin !== popupOrigin) return;

      const data = event.data;
      if (!data) return;

      if (data.type === 'fotos-id-ready') {
        popupWindow.postMessage({ type: 'fotos-id-request', requestId }, popupOrigin);
        return;
      }

      if (data.type === 'fotos-id-result') {
        if (data.requestId !== requestId) return;
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ success: data.success, data: data.data, error: data.error });
      }
    }

    window.addEventListener('message', handleMessage);

    checkClosedTimer = setInterval(() => {
      if (popupWindow.closed && !resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Fotos id popup was closed'));
      }
    }, 500);
  });
}
```

**Step 2: Verify it compiles**

Run: `cd vger/packages/glue.browser/browser-ui && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add vger/packages/glue.browser/browser-ui/src/lib/fotos-id-client.ts
git commit -m "feat(glue.browser): fotos id popup client with postMessage protocol"
```

---

### Task 5: glue.browser — add "Create fotos id" button to registration UI

**Files:**
- Modify: `vger/packages/glue.browser/browser-ui/src/components/SettingsPanel.tsx:845-933`
- Modify: `vger/packages/glue.browser/browser-ui/src/App.tsx:1612-1730`

**Step 1: Add fotos id button to SettingsPanel registration form**

In `SettingsPanel.tsx`, the registration section starts at line 845 (`<CollapsibleSection title="glue.one" defaultOpen>`). Currently it shows a name input + checkmark button.

Add a "Create fotos id" button above the name input. The name input + key generation becomes the "fallback" path, collapsed by default.

Reference the existing registration UI structure at `SettingsPanel.tsx:845-933`.

The button calls a new `onFotosIdCreated` prop that's passed down from App.tsx.

**Step 2: Add fotos id handler to App.tsx**

In `App.tsx`, add a `handleFotosIdCreated` callback alongside the existing `handleIdentityCreated` (line 1612). This handler:
1. Calls `openFotosIdPopup()` from the new fotos-id-client.ts
2. On success: receives `{ identity, displayName, cert, publicKey }`
3. Stores credentials in localStorage (same pattern as existing identity flow)
4. Calls `model.switchIdentityWithKeys()` to adopt the fotos-derived identity
5. Persists cert + displayName to settingsPlan
6. Updates React state

Reference the existing `handleIdentityCreated` at `App.tsx:1612-1730` for the pattern.

**Step 3: Verify manually**

1. Start fotos dev server: `cd fotos.browser/browser-ui && pnpm dev`
2. Start glue dev server: `cd vger/packages/glue.browser/browser-ui && pnpm dev`
3. Open glue.one locally → see "Create fotos id" button
4. Click → fotos popup opens
5. Complete flow → popup closes, glue.browser has identity

**Step 4: Commit**

```bash
git add vger/packages/glue.browser/browser-ui/src/components/SettingsPanel.tsx vger/packages/glue.browser/browser-ui/src/App.tsx
git commit -m "feat(glue.browser): fotos id as primary registration, key generation as fallback"
```

---

### Task 6: vger.headless — device key storage: multi-key support

**Files:**
- Modify: `vger/packages/vger.headless/src/handlers/registration-handlers.ts`

**Step 1: Change device key storage pattern**

In `registration-handlers.ts`, find `storeDeviceKey` (around line 1550-1580). Currently:

```ts
[`dk:${identity}`]: JSON.stringify({
  encryptionKey,
  signingKey,
  addedAt: Date.now(),
})
```

Change to:

```ts
[`dk:${identity}:${encryptionKey}`]: JSON.stringify({
  signingKey,
  addedAt: Date.now(),
})
```

**Step 2: Update rehydrateDeviceKeyIndex**

In `rehydrateDeviceKeyIndex` (around line 1606-1630), currently:

```ts
if (!key.startsWith('dk:') || typeof raw !== 'string') continue;
// ...
this.deviceKeyIndex.set(entry.encryptionKey, { identity: key.substring(3), signingKey: entry.signingKey ?? '' });
```

Change the identity extraction to parse both old (`dk:{identity}`) and new (`dk:{identity}:{encryptionKeyHex}`) formats:

```ts
if (!key.startsWith('dk:') || typeof raw !== 'string') continue;
const rest = key.substring(3); // "{identity}" or "{identity}:{encryptionKey}"
const colonIdx = rest.indexOf(':');
if (colonIdx !== -1) {
  // New format: dk:{identity}:{encryptionKey}
  const identity = rest.substring(0, colonIdx);
  const encryptionKey = rest.substring(colonIdx + 1);
  this.deviceKeyIndex.set(encryptionKey, { identity, signingKey: entry.signingKey ?? '' });
} else {
  // Legacy format: dk:{identity} with encryptionKey inside value
  this.deviceKeyIndex.set(entry.encryptionKey, { identity: rest, signingKey: entry.signingKey ?? '' });
}
```

**Step 3: Update lookupByEncryptionKey and getAllDeviceKeys**

Verify that `lookupByEncryptionKey()` (around line 1587) still works — it reads from the in-memory `deviceKeyIndex` map which is keyed by encryptionKey regardless of storage format, so it should need no changes.

Verify `getAllDeviceKeys()` (around line 1595) still works — same reasoning.

**Step 4: Run existing tests**

Run: `cd vger && pnpm test -- --filter vger.headless`
Expected: All existing tests pass

**Step 5: Commit**

```bash
git add vger/packages/vger.headless/src/handlers/registration-handlers.ts
git commit -m "feat(vger.headless): device key storage supports multiple keys per identity"
```

---

### Task 7: End-to-end manual test

**No files modified — verification only.**

**Step 1: Start all services**

```bash
# Terminal 1: fotos dev server
cd fotos/fotos.browser/browser-ui && pnpm dev

# Terminal 2: glue dev server
cd vger/packages/glue.browser/browser-ui && pnpm dev

# Terminal 3: headless (if running locally)
cd vger/packages/vger.headless && pnpm dev
```

**Step 2: Test the happy path**

1. Open glue.one locally (http://localhost:5511)
2. See "Create fotos id" as primary button in registration
3. Click it → popup opens to http://localhost:5188/fotos-id.html
4. In popup: enter display name, pick 2+ photos, enter 8-digit date PIN
5. Click "Create" → key derivation runs → cert registered → popup closes
6. glue.browser now shows the identity as registered
7. Verify name appears in header
8. Verify passkey can be added

**Step 3: Test the fallback path**

1. Open glue.one locally, clear localStorage
2. Click the fallback "Generate key" option
3. Enter name, confirm → existing key-generation flow works as before

**Step 4: Test popup closed early**

1. Click "Create fotos id"
2. Close the popup before completing
3. glue.browser should show a "Popup was closed" error, not hang

# ONE Auth: FedCM + Ed25519 Federated Identity — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable federated identity across ONE apps (fotos.one, glue.one, vger.one, reaktor.one) using FedCM with Ed25519-signed assertions, with popup/redirect fallback for Safari/Firefox.

**Architecture:** glue.one is the primary FedCM Identity Provider (it has vger.headless backend with registration, passkey, and certificate endpoints). Each app (fotos.one, vger.one, reaktor.one) acts as a Relying Party that accepts ONE Auth tokens. The existing AuthPopup postMessage protocol at glue.one/auth is extended to handle FedCM fallback flows. A shared `one-auth` client library (added to auth.core) provides the RP-side integration. The token format is a JSON envelope with an Ed25519-signed assertion — self-verifying, no callback to IdP needed.

**Tech Stack:** TypeScript, React, Vite, Cloudflare Pages, Express (vger.headless), Ed25519 (one.core tweetnacl + Web Crypto), FedCM browser API.

---

## Area 1: FedCM IdP Server Endpoints (vger.headless)

These endpoints are served by vger.headless at `api.glue.one` and proxied where needed.

### Task 1.1: FedCM Config Endpoint

**Files:**
- Modify: `/Users/gecko/src/vger/packages/vger.headless/src/transport/http-controller.ts` (add routes)

**Step 1: Write the failing test**

Create a test that hits `GET /api/fedcm/config` and expects FedCM config JSON.

```typescript
// In appropriate test file for http-controller
describe('FedCM config endpoint', () => {
  it('returns FedCM configuration JSON', async () => {
    const res = await fetch(`${BASE_URL}/api/fedcm/config`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.accounts_endpoint).toBe('/api/fedcm/accounts');
    expect(body.id_assertion_endpoint).toBe('/api/fedcm/assertion');
    expect(body.login_url).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/gecko/src/vger && pnpm --filter vger.headless test -- --grep "FedCM config"`
Expected: FAIL — route not found, 404.

**Step 3: Write minimal implementation**

Add to `http-controller.ts` in the public routes section (near existing `/api/registration/*` routes):

```typescript
// FedCM Identity Provider endpoints
router.get('/api/fedcm/config', (_req, res) => {
  res.json({
    accounts_endpoint: '/api/fedcm/accounts',
    id_assertion_endpoint: '/api/fedcm/assertion',
    login_url: '/login',
    branding: {
      background_color: '#1a1a2e',
      color: '#ffffff',
      icons: [{ url: 'https://glue.one/icon-64.png', size: 64 }],
    },
  });
});
```

Also add `/api/fedcm/config` to the `PUBLIC_ROUTES` array.

**Step 4: Run test to verify it passes**

Run: `cd /Users/gecko/src/vger && pnpm --filter vger.headless test -- --grep "FedCM config"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vger.headless/src/transport/http-controller.ts
git commit -m "feat(headless): add FedCM config endpoint"
```

---

### Task 1.2: FedCM Accounts Endpoint

**Files:**
- Modify: `/Users/gecko/src/vger/packages/vger.headless/src/transport/http-controller.ts`

**Context:** The accounts endpoint is called by the browser's FedCM machinery with cookies (SameSite=None). It must return the logged-in user's identity. It uses the existing session/certificate infrastructure.

**Step 1: Write the failing test**

```typescript
describe('FedCM accounts endpoint', () => {
  it('rejects requests without Sec-Fetch-Dest: webidentity', async () => {
    const res = await fetch(`${BASE_URL}/api/fedcm/accounts`);
    expect(res.status).toBe(400);
  });

  it('returns 401 when no session cookie', async () => {
    const res = await fetch(`${BASE_URL}/api/fedcm/accounts`, {
      headers: { 'Sec-Fetch-Dest': 'webidentity' },
    });
    expect(res.status).toBe(401);
  });

  it('returns accounts array for authenticated user', async () => {
    // Login first to get session cookie
    const loginRes = await authenticateTestUser();
    const cookie = loginRes.headers.get('set-cookie');

    const res = await fetch(`${BASE_URL}/api/fedcm/accounts`, {
      headers: {
        'Sec-Fetch-Dest': 'webidentity',
        Cookie: cookie,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toBeInstanceOf(Array);
    expect(body.accounts[0].id).toBeDefined();
    expect(body.accounts[0].name).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/gecko/src/vger && pnpm --filter vger.headless test -- --grep "FedCM accounts"`
Expected: FAIL — 404.

**Step 3: Write minimal implementation**

```typescript
router.get('/api/fedcm/accounts', async (req, res) => {
  // Verify FedCM request
  if (req.headers['sec-fetch-dest'] !== 'webidentity') {
    return res.status(400).json({ error: 'not a FedCM request' });
  }

  // Resolve session from cookie (reuse existing auth middleware)
  const session = await resolveSessionFromCookie(req);
  if (!session) {
    return res.status(401).json({ error: 'not logged in' });
  }

  res.json({
    accounts: [{
      id: session.personId,
      name: session.identity || session.personId,
      email: session.email || undefined,
      approved_clients: [],
      login_hints: [session.personId, session.identity].filter(Boolean),
    }],
  });
});
```

The `resolveSessionFromCookie` function should reuse the existing session resolution from `auth-middleware.ts` — the certificate session or auth session cookie pattern already in place.

**Step 4: Run test to verify it passes**

Run: `cd /Users/gecko/src/vger && pnpm --filter vger.headless test -- --grep "FedCM accounts"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vger.headless/src/transport/http-controller.ts
git commit -m "feat(headless): add FedCM accounts endpoint"
```

---

### Task 1.3: FedCM Assertion Endpoint

**Files:**
- Modify: `/Users/gecko/src/vger/packages/vger.headless/src/transport/http-controller.ts`

**Context:** The assertion endpoint is the core of FedCM — it issues Ed25519-signed tokens. The headless server signs using the registration authority key (not the user's device key). The token is self-verifying: the RP checks the signature against the embedded public key. Trust is established because the server only signs for authenticated sessions.

**Step 1: Write the failing test**

```typescript
describe('FedCM assertion endpoint', () => {
  it('rejects requests without Sec-Fetch-Dest: webidentity', async () => {
    const res = await fetch(`${BASE_URL}/api/fedcm/assertion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'account_id=test&client_id=example.com&nonce=abc',
    });
    expect(res.status).toBe(400);
  });

  it('issues a signed token for authenticated session', async () => {
    const loginRes = await authenticateTestUser();
    const cookie = loginRes.headers.get('set-cookie');
    const nonce = crypto.randomUUID();

    const res = await fetch(`${BASE_URL}/api/fedcm/assertion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Sec-Fetch-Dest': 'webidentity',
        'Origin': 'https://example.com',
        Cookie: cookie,
      },
      body: new URLSearchParams({
        account_id: testPersonId,
        client_id: 'example.com',
        nonce: nonce,
      }).toString(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();

    // Parse and verify token structure
    const token = JSON.parse(body.token);
    expect(token.assertion.iss).toBe('https://glue.one');
    expect(token.assertion.nonce).toBe(nonce);
    expect(token.assertion.aud).toBe('https://example.com');
    expect(token.signature).toBeDefined();
    expect(token.pubkey).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — 404.

**Step 3: Write minimal implementation**

```typescript
import { sign } from '@refinio/one.core/lib/crypto/sign.js';

router.post('/api/fedcm/assertion', async (req, res) => {
  if (req.headers['sec-fetch-dest'] !== 'webidentity') {
    return res.status(400).json({ error: { code: 'invalid_request' } });
  }

  const { account_id, client_id, nonce } = req.body;
  const rpOrigin = req.headers['origin'];

  const session = await resolveSessionFromCookie(req);
  if (!session || session.personId !== account_id) {
    return res.status(403).json({
      error: { code: 'access_denied' },
    });
  }

  // Get the authority's signing key (server key, not user key)
  const { secretSignKey, publicSignKeyHex } = getAuthorityKeys();

  const now = Math.floor(Date.now() / 1000);
  const assertion = {
    iss: 'https://glue.one',
    sub: account_id,
    aud: rpOrigin,
    client_id,
    nonce,
    iat: now,
    exp: now + 300,
    one_pubkey: publicSignKeyHex,
    one_person_id: account_id,
  };

  const payload = new TextEncoder().encode(JSON.stringify(assertion));
  const signature = sign(payload, secretSignKey);

  const token = JSON.stringify({
    assertion,
    signature: uint8arrayToHexString(signature),
    pubkey: publicSignKeyHex,
  });

  // CORS for credentialed request
  res.set('Access-Control-Allow-Origin', rpOrigin);
  res.set('Access-Control-Allow-Credentials', 'true');
  res.json({ token });
});
```

Note: Uses `getAuthorityKeys()` which should already exist or be derived from the registration authority infrastructure (`/api/registration/authority/publicKey` endpoint).

**Step 4: Run test to verify it passes**

Expected: PASS

**Step 5: Commit**

```bash
git add packages/vger.headless/src/transport/http-controller.ts
git commit -m "feat(headless): add FedCM assertion endpoint with Ed25519 signing"
```

---

### Task 1.4: FedCM CORS Preflight + Login Status Header

**Files:**
- Modify: `/Users/gecko/src/vger/packages/vger.headless/src/transport/http-controller.ts`

**Step 1: Add CORS preflight handler for assertion endpoint**

```typescript
router.options('/api/fedcm/assertion', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers['origin']);
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Sec-Fetch-Dest');
  res.status(204).end();
});
```

**Step 2: Add `Set-Login` header to existing login/logout responses**

In the existing `/api/auth/certificate/login` success handler, add:
```typescript
res.set('Set-Login', 'logged-in');
```

In the existing `/api/auth/logout` handler, add:
```typescript
res.set('Set-Login', 'logged-out');
```

**Step 3: Commit**

```bash
git add packages/vger.headless/src/transport/http-controller.ts
git commit -m "feat(headless): add FedCM CORS preflight and Set-Login headers"
```

---

## Area 2: Static FedCM Discovery Files

### Task 2.1: glue.one Well-Known + Config Files

**Files:**
- Create: `/Users/gecko/src/vger/packages/glue.browser/browser-ui/public/.well-known/web-identity` (static JSON)
- The `fedcm/config.json` is served dynamically by Task 1.1, but we also add a static fallback.

**Step 1: Create `.well-known/web-identity`**

```json
{
  "provider_urls": ["https://glue.one/api/fedcm/config"]
}
```

Note: The `provider_urls` points to the headless API path since Caddy proxies `/api/*` to vger.headless.

**Step 2: Verify serving in dev**

Run: `cd /Users/gecko/src/vger/packages/glue.browser/browser-ui && pnpm dev`
Then: `curl http://localhost:5511/.well-known/web-identity`
Expected: Returns the JSON above.

**Step 3: Commit**

```bash
git add packages/glue.browser/browser-ui/public/.well-known/web-identity
git commit -m "feat(glue.browser): add FedCM well-known discovery file"
```

---

### Task 2.2: fotos.one FedCM Proxy via Edge Worker

**Files:**
- Modify: `/Users/gecko/src/fotos/fotos.browser/browser-ui/public/_worker.js`
- Create: `/Users/gecko/src/fotos/fotos.browser/browser-ui/public/.well-known/web-identity`

**Context:** fotos.one is on Cloudflare Pages. For fotos.one to also act as an IdP (or delegate to glue.one), it needs a `.well-known/web-identity` file. We point it at glue.one's FedCM config since glue.one is the actual IdP.

**Step 1: Create `.well-known/web-identity`**

```json
{
  "provider_urls": ["https://glue.one/api/fedcm/config"]
}
```

**Step 2: Commit**

```bash
git add fotos.browser/browser-ui/public/.well-known/web-identity
git commit -m "feat(fotos.browser): add FedCM well-known pointing to glue.one IdP"
```

---

## Area 3: Fallback Auth Page (Safari/Firefox)

The existing `AuthPopup.tsx` at glue.one/auth handles passkey flows via postMessage. We extend it with a new action type for ONE Auth token issuance (fallback for non-FedCM browsers).

### Task 3.1: Add `one-auth` Action to AuthPopup Protocol

**Files:**
- Modify: `/Users/gecko/src/vger/packages/glue.browser/browser-ui/src/AuthPopup.tsx`

**Step 1: Write the failing test**

```typescript
describe('AuthPopup one-auth action', () => {
  it('accepts one-auth action and returns signed assertion', () => {
    // This is an integration test — verify via manual popup testing
    // or via the auth-client test below
  });
});
```

**Step 2: Extend `AuthRequest` interface and handler**

In `AuthPopup.tsx`, add the new action type:

```typescript
interface AuthRequest {
  type: 'auth-request';
  requestId: string;
  action: 'passkey-auth' | 'passkey-register' | 'passkey-list' | 'passkey-delete' | 'certify' | 'one-auth-token';
  name: string;
  // ... existing fields ...
  // New fields for one-auth-token:
  clientId?: string;
  nonce?: string;
  rpOrigin?: string;
}
```

Add handler function:

```typescript
async function handleOneAuthToken(req: AuthRequest): Promise<{ success: boolean; data?: any; error?: string }> {
  // Get current session's signing key from ONE.core
  const { getInstanceOwnerIdHash } = await import('@refinio/one.core/lib/instance.js');
  const { getDefaultKeys } = await import('@refinio/one.core/lib/keychain/keychain.js');
  const { sign } = await import('@refinio/one.core/lib/crypto/sign.js');

  const personIdHash = getInstanceOwnerIdHash();
  const keys = await getDefaultKeys(personIdHash);

  const now = Math.floor(Date.now() / 1000);
  const assertion = {
    iss: window.location.origin,
    sub: personIdHash,
    aud: req.rpOrigin,
    client_id: req.clientId,
    nonce: req.nonce,
    iat: now,
    exp: now + 300,
    one_person_id: personIdHash,
    one_pubkey: keys.publicSignKey,
  };

  const payload = new TextEncoder().encode(JSON.stringify(assertion));
  const signature = sign(payload, keys.secretSignKey);

  const token = JSON.stringify({
    assertion,
    signature: uint8arrayToHexString(signature),
    pubkey: keys.publicSignKey,
  });

  return { success: true, data: { token } };
}
```

Add the case to the switch statement:

```typescript
case 'one-auth-token':
  setStatus('Signing identity token...');
  result = await handleOneAuthToken(req);
  break;
```

**Step 3: Commit**

```bash
git add packages/glue.browser/browser-ui/src/AuthPopup.tsx
git commit -m "feat(glue.browser): add one-auth-token action to AuthPopup"
```

---

### Task 3.2: Standalone Fallback Auth Page

**Files:**
- Create: `/Users/gecko/src/vger/packages/glue.browser/browser-ui/public/one-auth.html`

**Context:** For cases where the RP doesn't have the glue.one auth client (third-party sites), provide a standalone consent page that handles the full flow with redirect or popup mode.

**Step 1: Create the HTML page**

This is the consent screen from Part 2 of the spec. It reads query params (`client_id`, `nonce`, `return_url`, `response_mode`), shows the user's identity, and signs an assertion on approval.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in with ONE</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; margin: 0;
      background: #1a1a2e; color: #fff;
    }
    .consent-card {
      background: #16213e; border-radius: 16px; padding: 32px;
      max-width: 400px; width: 90%; text-align: center;
    }
    .identity-name { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    .identity-id { font-size: 12px; color: #888; word-break: break-all; margin-bottom: 24px; }
    .rp-origin { font-size: 14px; color: #aaa; margin-bottom: 24px; }
    .btn {
      display: inline-block; padding: 12px 32px; border-radius: 8px;
      border: none; cursor: pointer; font-size: 16px; margin: 0 8px;
    }
    .btn-approve { background: #4ecca3; color: #1a1a2e; font-weight: 600; }
    .btn-deny { background: transparent; color: #888; border: 1px solid #333; }
    #loading { text-align: center; }
    #consent { display: none; }
    #login-prompt { display: none; text-align: center; }
  </style>
</head>
<body>
  <div class="consent-card">
    <div id="loading">Loading identity...</div>
    <div id="login-prompt">
      <p>Please sign in first.</p>
      <button class="btn btn-approve" id="do-login">Sign in</button>
    </div>
    <div id="consent">
      <div class="identity-name" id="name"></div>
      <div class="identity-id" id="personId"></div>
      <div class="rp-origin" id="rpInfo"></div>
      <button class="btn btn-approve" id="approve">Approve</button>
      <button class="btn btn-deny" id="deny">Deny</button>
    </div>
  </div>

  <script type="module">
    // This page delegates to the AuthPopup mechanism via an inline flow.
    // It loads the ONE.core identity and signs the assertion client-side.
    // See Task 3.1 for the signing implementation.
    //
    // The full implementation will import from the built auth bundle
    // and use the same Ed25519 signing path as AuthPopup.
    //
    // Params: ?client_id=X&nonce=Y&return_url=Z&response_mode=popup|redirect

    const params = new URLSearchParams(window.location.search);
    const clientId = params.get('client_id');
    const nonce = params.get('nonce');
    const returnUrl = params.get('return_url');
    const responseMode = params.get('response_mode') || 'redirect';

    // Validate
    if (!returnUrl) {
      document.getElementById('loading').textContent = 'Missing return_url.';
      throw new Error('Missing return_url');
    }

    let rpOrigin;
    try {
      rpOrigin = new URL(returnUrl).origin;
    } catch {
      document.getElementById('loading').textContent = 'Invalid return URL.';
      throw new Error('Invalid return_url');
    }

    // Check for existing session via headless API
    const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
    const session = sessionRes.ok ? await sessionRes.json() : null;

    if (!session?.authenticated) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('login-prompt').style.display = 'block';
      document.getElementById('do-login').addEventListener('click', () => {
        window.location.href = `/login?return=${encodeURIComponent(window.location.href)}`;
      });
    } else {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('consent').style.display = 'block';
      document.getElementById('name').textContent = session.data.identity || 'ONE Identity';
      document.getElementById('personId').textContent = session.data.personId || '';
      document.getElementById('rpInfo').textContent = `${rpOrigin} wants to verify your ONE identity`;

      document.getElementById('deny').addEventListener('click', () => {
        if (responseMode === 'popup') window.close();
        else window.location.href = returnUrl;
      });

      document.getElementById('approve').addEventListener('click', async () => {
        // Request token from headless
        const tokenRes = await fetch('/api/fedcm/assertion', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Sec-Fetch-Dest': 'webidentity',
          },
          credentials: 'include',
          body: new URLSearchParams({
            account_id: session.data.personId,
            client_id: clientId || rpOrigin,
            nonce: nonce || '',
          }),
        });

        const tokenBody = await tokenRes.json();

        if (responseMode === 'popup') {
          window.opener.postMessage(
            { type: 'one-auth-response', token: tokenBody.token },
            rpOrigin,
          );
        } else {
          const url = new URL(returnUrl);
          url.searchParams.set('one_token', tokenBody.token);
          window.location.href = url.toString();
        }
      });
    }
  </script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add packages/glue.browser/browser-ui/public/one-auth.html
git commit -m "feat(glue.browser): add standalone ONE Auth consent page for fallback flow"
```

---

## Area 4: RP Client Library (auth.core)

### Task 4.1: OneAuth Client Class

**Files:**
- Create: `/Users/gecko/src/vger/packages/auth.core/src/one-auth/one-auth.ts`
- Modify: `/Users/gecko/src/vger/packages/auth.core/src/index.ts` (add exports)

**Context:** This is the drop-in client library that any RP includes. It tries FedCM first, falls back to popup, then redirect. Reuses the existing `openAuthPopup` pattern from `auth-client.ts`.

**Step 1: Write the failing test**

```typescript
// /Users/gecko/src/vger/packages/auth.core/src/one-auth/one-auth.test.ts
import { describe, it, expect } from 'vitest';
import { verifyOneAuthToken } from './one-auth.js';

describe('verifyOneAuthToken', () => {
  it('rejects malformed token JSON', async () => {
    await expect(verifyOneAuthToken('not json', 'nonce', 'https://example.com'))
      .rejects.toThrow('Malformed token');
  });

  it('rejects token missing required fields', async () => {
    await expect(verifyOneAuthToken('{}', 'nonce', 'https://example.com'))
      .rejects.toThrow('missing assertion');
  });

  it('rejects expired token', async () => {
    const expiredToken = JSON.stringify({
      assertion: {
        iss: 'https://glue.one',
        sub: 'test',
        aud: 'https://example.com',
        nonce: 'nonce',
        iat: 1000,
        exp: 1001, // long expired
        one_person_id: 'test',
        one_pubkey: 'deadbeef',
      },
      signature: 'deadbeef',
      pubkey: 'deadbeef',
    });
    await expect(verifyOneAuthToken(expiredToken, 'nonce', 'https://example.com'))
      .rejects.toThrow('expired');
  });

  it('rejects audience mismatch', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = JSON.stringify({
      assertion: {
        iss: 'https://glue.one',
        sub: 'test',
        aud: 'https://wrong-site.com',
        nonce: 'nonce',
        iat: now,
        exp: now + 300,
        one_person_id: 'test',
        one_pubkey: 'deadbeef',
      },
      signature: 'deadbeef',
      pubkey: 'deadbeef',
    });
    await expect(verifyOneAuthToken(token, 'nonce', 'https://example.com'))
      .rejects.toThrow('Audience mismatch');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/gecko/src/vger && pnpm --filter auth.core test -- --grep "verifyOneAuthToken"`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// /Users/gecko/src/vger/packages/auth.core/src/one-auth/one-auth.ts

const DEFAULT_IDP_ORIGIN = 'https://glue.one';
const AUTH_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

// ─── Utilities ───────────────────────────────────────────────────

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function hasFedCM(): boolean {
  try {
    return (
      'IdentityCredential' in window &&
      typeof navigator?.credentials?.get === 'function'
    );
  } catch {
    return false;
  }
}

// ─── Token Verification ─────────────────────────────────────────

export interface OneAuthResult {
  personId: string;
  pubkey: string;
  displayName?: string;
  assertion: Record<string, unknown>;
  raw: string;
}

export async function verifyOneAuthToken(
  tokenString: string,
  expectedNonce: string | null,
  expectedAudience: string | null,
): Promise<OneAuthResult> {
  let parsed: { assertion?: any; signature?: string; pubkey?: string };
  try {
    parsed = JSON.parse(tokenString);
  } catch {
    throw new Error('Malformed token: not valid JSON');
  }

  const { assertion, signature, pubkey } = parsed;

  if (!assertion || !signature || !pubkey) {
    throw new Error('Malformed token: missing assertion, signature, or pubkey');
  }

  // Reconstruct payload exactly as signed
  const payload = new TextEncoder().encode(JSON.stringify(assertion));

  // Import Ed25519 public key and verify signature
  // Try Web Crypto first, fall back to tweetnacl
  const pubkeyBytes = hexToUint8Array(pubkey);
  const signatureBytes = hexToUint8Array(signature);

  let valid = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubkeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify('Ed25519', cryptoKey, signatureBytes, payload);
  } catch {
    // Web Crypto Ed25519 not supported — try tweetnacl
    const nacl = await import('tweetnacl');
    valid = nacl.sign.detached.verify(payload, signatureBytes, pubkeyBytes);
  }

  if (!valid) {
    throw new Error('Invalid Ed25519 signature');
  }

  // Verify claims
  const now = Math.floor(Date.now() / 1000);

  if (expectedAudience && assertion.aud !== expectedAudience) {
    throw new Error(`Audience mismatch: expected ${expectedAudience}, got ${assertion.aud}`);
  }

  if (expectedNonce && assertion.nonce !== expectedNonce) {
    throw new Error('Nonce mismatch — possible replay attack');
  }

  if (assertion.exp && assertion.exp < now) {
    throw new Error('Token expired');
  }

  if (assertion.iat && assertion.iat > now + 60) {
    throw new Error('Token issued in the future — clock skew?');
  }

  return {
    personId: assertion.one_person_id || assertion.sub,
    pubkey,
    displayName: assertion.name,
    assertion,
    raw: tokenString,
  };
}

// ─── FedCM Transport ────────────────────────────────────────────

async function loginViaFedCM(
  configURL: string,
  clientId: string,
  nonce: string,
  mode: 'active' | 'passive' = 'active',
): Promise<string> {
  const credential = await (navigator.credentials as any).get({
    identity: {
      providers: [{ configURL, clientId, nonce }],
      mode,
    },
  });
  return (credential as any).token;
}

// ─── Popup Transport ────────────────────────────────────────────

function loginViaPopup(authUrl: string, idpOrigin: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const width = 500;
    const height = 600;
    const left = Math.round((screen.width - width) / 2);
    const top = Math.round((screen.height - height) / 2);

    const popup = window.open(
      authUrl,
      'one-auth',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`,
    );

    if (!popup || popup.closed) {
      reject(new Error('popup_blocked'));
      return;
    }

    let settled = false;

    const cleanup = () => {
      settled = true;
      window.removeEventListener('message', messageHandler);
      clearInterval(pollTimer);
      clearTimeout(timeout);
    };

    const messageHandler = (event: MessageEvent) => {
      if (settled) return;
      if (event.origin !== idpOrigin) return;
      if (event.data?.type !== 'one-auth-response') return;

      cleanup();
      try { popup.close(); } catch {}
      resolve(event.data.token);
    };

    window.addEventListener('message', messageHandler);

    const pollTimer = setInterval(() => {
      if (settled) return;
      try {
        if (popup.closed) {
          cleanup();
          resolve(null); // cancelled
        }
      } catch {}
    }, POLL_INTERVAL_MS);

    const timeout = setTimeout(() => {
      if (settled) return;
      cleanup();
      try { popup.close(); } catch {}
      reject(new Error('Authentication timed out'));
    }, AUTH_TIMEOUT_MS);
  });
}

// ─── Main Class ─────────────────────────────────────────────────

export interface OneAuthOptions {
  idpOrigin?: string;
  configURL?: string;
  clientId?: string;
}

export interface OneAuthLoginOptions {
  clientId?: string;
  mode?: 'active' | 'passive';
  popup?: boolean;
  returnUrl?: string;
}

export class OneAuth {
  readonly idpOrigin: string;
  readonly configURL: string;
  readonly clientId: string;

  constructor(options: OneAuthOptions = {}) {
    this.idpOrigin = options.idpOrigin || DEFAULT_IDP_ORIGIN;
    this.configURL = options.configURL || `${this.idpOrigin}/api/fedcm/config`;
    this.clientId = options.clientId || window.location.hostname;
  }

  async login(options: OneAuthLoginOptions = {}): Promise<OneAuthResult | { cancelled: true }> {
    const clientId = options.clientId || this.clientId;
    const nonce = crypto.randomUUID();
    const preferPopup = options.popup !== false;
    const returnUrl = options.returnUrl || window.location.href;

    // Store nonce for verification
    try {
      sessionStorage.setItem('one_auth_nonce', nonce);
    } catch {}

    // Try FedCM first
    if (hasFedCM()) {
      try {
        const token = await loginViaFedCM(
          this.configURL,
          clientId,
          nonce,
          options.mode || 'active',
        );
        return await verifyOneAuthToken(token, nonce, window.location.origin);
      } catch (e: any) {
        if (e.name === 'NotAllowedError') {
          return { cancelled: true };
        }
        console.warn('[one-auth] FedCM failed, falling back:', e.message);
      }
    }

    // Fallback: popup or redirect
    const authParams = new URLSearchParams({
      client_id: clientId,
      nonce,
      return_url: returnUrl,
      response_mode: preferPopup ? 'popup' : 'redirect',
    });

    const authUrl = `${this.idpOrigin}/one-auth.html?${authParams}`;

    if (preferPopup) {
      try {
        const token = await loginViaPopup(authUrl, this.idpOrigin);
        if (token === null) return { cancelled: true };
        return await verifyOneAuthToken(token, nonce, window.location.origin);
      } catch (e: any) {
        if (e.message === 'popup_blocked') {
          console.warn('[one-auth] Popup blocked, falling back to redirect');
        } else {
          throw e;
        }
      }
    }

    // Final fallback: redirect
    window.location.href = `${this.idpOrigin}/one-auth.html?${new URLSearchParams({
      client_id: clientId,
      nonce,
      return_url: returnUrl,
      response_mode: 'redirect',
    })}`;
    return new Promise(() => {}); // never resolves — page navigates away
  }

  async handleRedirectReturn(): Promise<OneAuthResult | null> {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('one_token');
    if (!token) return null;

    // Clean URL
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('one_token');
    window.history.replaceState({}, '', cleanUrl.toString());

    let nonce: string | null = null;
    try {
      nonce = sessionStorage.getItem('one_auth_nonce');
      sessionStorage.removeItem('one_auth_nonce');
    } catch {}

    return verifyOneAuthToken(token, nonce, window.location.origin);
  }

  async verify(tokenString: string, options: { nonce?: string; audience?: string } = {}): Promise<OneAuthResult> {
    return verifyOneAuthToken(
      tokenString,
      options.nonce || null,
      options.audience || window.location.origin,
    );
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/gecko/src/vger && pnpm --filter auth.core test -- --grep "verifyOneAuthToken"`
Expected: PASS

**Step 5: Add exports to index**

In `/Users/gecko/src/vger/packages/auth.core/src/index.ts`, add:

```typescript
export { OneAuth, verifyOneAuthToken } from './one-auth/one-auth.js';
export type { OneAuthResult, OneAuthOptions, OneAuthLoginOptions } from './one-auth/one-auth.js';
```

**Step 6: Commit**

```bash
git add packages/auth.core/src/one-auth/ packages/auth.core/src/index.ts
git commit -m "feat(auth.core): add OneAuth client library with FedCM + popup + redirect"
```

---

## Area 5: fotos.one Identity UI Wiring

### Task 5.1: Add "Sign in with ONE" to FotosSettings

**Files:**
- Modify: `/Users/gecko/src/fotos/fotos.browser/browser-ui/src/components/FotosSettings.tsx`

**Context:** FotosSettings already has the "Sign in with glue.one" button that uses `authenticateWithPasskeyViaPopup`. We're adding a section that shows the ONE Auth identity state and allows login via the OneAuth client.

**Step 1: Add login status API call on mount**

In the existing `useEffect` that loads identity state, add after successful certification check:

```typescript
// Set FedCM login status for browser
if ('login' in navigator) {
  (navigator as any).login.setStatus(
    certState === 'certified' ? 'logged-in' : 'logged-out'
  );
}
```

**Step 2: No additional UI changes needed**

The existing FotosSettings UI already shows:
- Identity section with ephemeral/anchored/certified states
- "Sign in with glue.one" button (calls `authenticateWithPasskeyViaPopup`)
- Recovery section with photo-key derivation

The FedCM login status call in Step 1 is the key piece that makes fotos.one work as a FedCM-aware site. When the user is certified, the browser knows they're logged in at this origin.

**Step 3: Commit**

```bash
git add fotos.browser/browser-ui/src/components/FotosSettings.tsx
git commit -m "feat(fotos): set FedCM login status on identity state change"
```

---

### Task 5.2: Handle Redirect Return on Fotos Boot

**Files:**
- Modify: `/Users/gecko/src/fotos/fotos.browser/browser-ui/src/lib/onecore-boot.ts`

**Context:** If fotos.one is used as an RP (receiving auth from another ONE app), it needs to handle the redirect return with `one_token` in the URL.

**Step 1: Add redirect return handling at top of boot**

Near the beginning of `bootFotosModel()` (before ONE.core initialization), add:

```typescript
import { OneAuth } from '@glueone/auth.core';

// Check for ONE Auth redirect return
const oneAuth = new OneAuth();
const redirectResult = await oneAuth.handleRedirectReturn();
if (redirectResult) {
  // Store the authenticated identity for use during boot
  sessionStorage.setItem('one_auth_identity', JSON.stringify({
    personId: redirectResult.personId,
    pubkey: redirectResult.pubkey,
    displayName: redirectResult.displayName,
  }));
}
```

**Step 2: Commit**

```bash
git add fotos.browser/browser-ui/src/lib/onecore-boot.ts
git commit -m "feat(fotos): handle ONE Auth redirect return on boot"
```

---

## Area 6: glue.browser Identity UI

### Task 6.1: Add FedCM Login Status to glue.browser

**Files:**
- Modify: `/Users/gecko/src/vger/packages/glue.browser/browser-ui/src/hooks/useGlueModel.ts` (or equivalent identity hook)

**Step 1: Set login status after identity resolution**

After the identity/certification check succeeds:

```typescript
// Inform browser of FedCM login state
if ('login' in navigator) {
  (navigator as any).login.setStatus('logged-in');
}
```

On logout or identity clear:

```typescript
if ('login' in navigator) {
  (navigator as any).login.setStatus('logged-out');
}
```

**Step 2: Commit**

```bash
git add packages/glue.browser/browser-ui/src/hooks/useGlueModel.ts
git commit -m "feat(glue.browser): set FedCM login status on identity change"
```

---

### Task 6.2: Accept ONE Auth Tokens in glue.browser Header

**Files:**
- Modify: `/Users/gecko/src/vger/packages/glue.browser/browser-ui/src/components/Header.tsx`

**Context:** The Header already has a "Sign in" button. We extend it to also accept ONE Auth tokens from external identity providers (e.g., fotos.one), in addition to the existing passkey flow.

**Step 1: Add ONE Auth redirect return handling**

In the main app entry or the Header's mount effect:

```typescript
import { OneAuth } from '@glueone/auth.core';

useEffect(() => {
  const oneAuth = new OneAuth();
  oneAuth.handleRedirectReturn().then(result => {
    if (result) {
      // Federated identity received — store and use
      console.log('[glue] Authenticated via ONE Auth:', result.personId);
      // Pin the public key for future verification
      localStorage.setItem(`one_pubkey_${result.personId}`, result.pubkey);
    }
  });
}, []);
```

**Step 2: Commit**

```bash
git add packages/glue.browser/browser-ui/src/components/Header.tsx
git commit -m "feat(glue.browser): handle ONE Auth redirect returns"
```

---

## Area 7: vger RP Integration

### Task 7.1: Add ONE Auth to vger.browser Login

**Files:**
- Modify: `/Users/gecko/src/vger/packages/vger.browser/browser-ui/src/components/LoginScreen.tsx`
- Modify: `/Users/gecko/src/vger/packages/vger.browser/browser-ui/src/main.tsx`

**Context:** vger.browser already has a LoginScreen with email + password and "Sign in with glue.one" via passkey. We add ONE Auth as an additional option.

**Step 1: Add redirect return handling to main.tsx**

Before React rendering in `main.tsx`:

```typescript
import { OneAuth } from '@glueone/auth.core';

const oneAuth = new OneAuth();
const redirectResult = await oneAuth.handleRedirectReturn();
if (redirectResult) {
  sessionStorage.setItem('one_auth_identity', JSON.stringify({
    personId: redirectResult.personId,
    pubkey: redirectResult.pubkey,
  }));
}
```

**Step 2: Add "Sign in with ONE" button to LoginScreen**

```tsx
import { OneAuth } from '@glueone/auth.core';

// In the LoginScreen component, add a button:
const handleOneAuth = useCallback(async () => {
  const oneAuth = new OneAuth();
  try {
    const result = await oneAuth.login({ popup: true });
    if ('cancelled' in result) return;
    // Use the authenticated identity
    onAuthenticated(result);
  } catch (err) {
    setError((err as Error).message);
  }
}, [onAuthenticated]);

// In the JSX:
<button onClick={handleOneAuth} className="...">
  Sign in with ONE
</button>
```

**Step 3: Commit**

```bash
git add packages/vger.browser/browser-ui/src/components/LoginScreen.tsx packages/vger.browser/browser-ui/src/main.tsx
git commit -m "feat(vger.browser): add ONE Auth login option"
```

---

## Area 8: reaktor RP Integration

### Task 8.1: Add Identity Section to SettingsPanel

**Files:**
- Modify: `/Users/gecko/src/reaktor/reaktor.browser/browser-ui/src/components/SettingsPanel.tsx`
- Modify: `/Users/gecko/src/reaktor/reaktor.browser/browser-ui/src/hooks/useReaktorModel.ts`

**Context:** reaktor currently has only appearance settings (theme, font size, compact mode). The settings button shows "Claim your identity" when ephemeral. We add an actual identity claiming flow via ONE Auth.

**Step 1: Add `@glueone/auth.core` dependency**

In `/Users/gecko/src/reaktor/reaktor.browser/browser-ui/package.json`, add:

```json
"@glueone/auth.core": "workspace:*"
```

Run: `cd /Users/gecko/src/reaktor && pnpm install`

**Step 2: Add identity section to SettingsPanel**

```tsx
import { OneAuth } from '@glueone/auth.core';
import type { OneAuthResult } from '@glueone/auth.core';

function IdentitySection({ ephemeral }: { ephemeral: boolean }) {
  const [authenticating, setAuthenticating] = useState(false);
  const [identity, setIdentity] = useState<OneAuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check for stored identity
  useEffect(() => {
    try {
      const stored = localStorage.getItem('one_auth_identity');
      if (stored) setIdentity(JSON.parse(stored));
    } catch {}
  }, []);

  const handleSignIn = useCallback(async () => {
    setAuthenticating(true);
    setError(null);
    try {
      const oneAuth = new OneAuth();
      const result = await oneAuth.login({ popup: true });
      if ('cancelled' in result) return;
      setIdentity(result);
      localStorage.setItem('one_auth_identity', JSON.stringify(result));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthenticating(false);
    }
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-header">Identity</div>
      {identity ? (
        <div className="settings-field">
          <span className="settings-label">{identity.displayName || identity.personId}</span>
          <span className="settings-hint">Verified via ONE</span>
        </div>
      ) : (
        <button
          onClick={handleSignIn}
          disabled={authenticating}
          className="settings-button"
        >
          {authenticating ? 'Signing in...' : 'Sign in with ONE'}
        </button>
      )}
      {error && <div className="settings-error">{error}</div>}
    </div>
  );
}
```

Add `<IdentitySection ephemeral={ephemeral} />` at the top of the SettingsPanel render.

**Step 3: Add redirect return handling to useReaktorModel.ts**

Before the boot sequence:

```typescript
import { OneAuth } from '@glueone/auth.core';

// At the top of the boot function, before ONE.core init:
const oneAuth = new OneAuth();
const redirectResult = await oneAuth.handleRedirectReturn();
if (redirectResult) {
  localStorage.setItem('one_auth_identity', JSON.stringify({
    personId: redirectResult.personId,
    pubkey: redirectResult.pubkey,
    displayName: redirectResult.displayName,
  }));
}
```

**Step 4: Commit**

```bash
git add reaktor.browser/browser-ui/src/components/SettingsPanel.tsx
git add reaktor.browser/browser-ui/src/hooks/useReaktorModel.ts
git add reaktor.browser/browser-ui/package.json
git commit -m "feat(reaktor): add ONE Auth identity section to settings"
```

---

## Area 9: fotos.one Identity Features (fotos id)

### Task 9.1: Wire Recovery Section to FedCM Identity

**Files:**
- Modify: `/Users/gecko/src/fotos/fotos.browser/browser-ui/src/components/FotosSettings.tsx`

**Context:** The RecoverySecretSection is already implemented and functional. The missing piece is connecting it to the FedCM identity flow so that the recovery key can be used to prove identity across apps.

**Step 1: Show recovery key status in identity section**

After the certified identity display, add a recovery key indicator:

```tsx
{certState === 'certified' && (
  <div className="px-2.5 text-[9px] text-white/20">
    Recovery key: {hasRecoveryKey ? 'configured' : 'not set'}
  </div>
)}
```

The `hasRecoveryKey` state can be derived by checking the recovery endpoint:

```typescript
const [hasRecoveryKey, setHasRecoveryKey] = useState(false);

useEffect(() => {
  if (certState !== 'certified' || !publicationIdentity) return;
  fetch(`${API_BASE}/api/recovery/status/${encodeURIComponent(publicationIdentity)}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data?.hasRecoveryKey) setHasRecoveryKey(true);
    })
    .catch(() => {});
}, [certState, publicationIdentity]);
```

**Step 2: Commit**

```bash
git add fotos.browser/browser-ui/src/components/FotosSettings.tsx
git commit -m "feat(fotos): show recovery key status in identity section"
```

---

### Task 9.2: Export Identity for Federation

**Files:**
- Modify: `/Users/gecko/src/fotos/fotos.browser/browser-ui/src/components/FotosSettings.tsx`

**Context:** When a user has a certified fotos.one identity, they should be able to use it on other ONE apps. Add a "Use on other apps" action that opens the ONE Auth consent flow.

**Step 1: Add federation info to identity section**

After the "Manage on glue.one" link:

```tsx
{syncEnabled && certState === 'certified' && (
  <div className="px-2.5 py-1.5 bg-white/5 rounded-md text-[10px] text-white/30 leading-relaxed">
    Your identity works across all ONE apps.
    Other sites can verify you via <span className="text-white/50">Sign in with ONE</span>.
  </div>
)}
```

This is informational — the actual federation happens automatically via the FedCM IdP endpoints (Area 1) and the Login Status API (Task 5.1).

**Step 2: Commit**

```bash
git add fotos.browser/browser-ui/src/components/FotosSettings.tsx
git commit -m "feat(fotos): add federation info to identity section"
```

---

## Dependency Graph

```
Area 1 (IdP endpoints)  ──────────────────────┐
                                               │
Area 2 (discovery files) ─── depends on 1 ────┤
                                               │
Area 3 (fallback page) ──── depends on 1 ─────┤
                                               │
Area 4 (client library) ─── independent ───────┤
                                               │
Area 5 (fotos UI) ──────── depends on 4 ──────┤
                                               │
Area 6 (glue UI) ───────── depends on 4 ──────┤
                                               │
Area 7 (vger UI) ───────── depends on 4 ──────┤
                                               │
Area 8 (reaktor UI) ────── depends on 4 ──────┤
                                               │
Area 9 (fotos id) ──────── depends on 5 ──────┘
```

**Parallelizable:** Areas 1+4 can run in parallel (no dependency). Areas 5-9 can all run in parallel once 4 is complete. Area 2+3 can run once Area 1 is complete.

**Recommended execution order:**
1. Area 4 (client library) — standalone, no server dependency for testing
2. Area 1 (server endpoints) — next, enables real integration
3. Areas 2+3 (discovery + fallback) — quick, depends on 1
4. Areas 5-9 (UI wiring) — all parallelizable, depend on 4

---

## Testing Strategy

**Unit tests:** Token verification (Area 4) — these are pure functions, easy to test.

**Integration tests:** Server endpoints (Area 1) — test against running vger.headless instance.

**Manual tests:** FedCM flows require real browser testing. Test matrix:
- Chrome 136+: Full FedCM flow
- Firefox: Popup fallback
- Safari 26+: Popup fallback with Web Crypto Ed25519
- Safari <26: Popup fallback with tweetnacl

**Dev workflow:** Each app has `pnpm dev` on a different port. Test cross-origin flows using:
- fotos.one → `localhost:5188`
- glue.one → `localhost:5511`
- vger.one → `localhost:5173` (or configured port)
- reaktor.one → `localhost:5180`

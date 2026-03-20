# fotos id: Consolidated Identity Section

**Goal:** Replace the three separate settings sections (Sync, Identity, Recovery) with a single "fotos id" section that handles sign-in, passkey convenience, and photo-based recovery in one unified flow.

---

## Design

### States

**Signed out** — no certification or sync disabled.
- Show "Sign in with ONE" button prominently.

**Signed in** — certified identity with sync active.
- Identity card: name, certified badge, passkey count, recovery status.
- Recovery setup inline if not yet configured.
- Small "Sign out" action at bottom.

### Sign-in Flow

**First visit (no passkey, no cert):**
1. User taps "Sign in with ONE"
2. OneAuth flow runs (FedCM → popup → redirect fallback)
3. On success → sync gets enabled, identity is certified
4. Prompt: "Save a passkey for faster sign-in?" [Save] [Skip]
5. If save → glue.one passkey registration flow

**Returning user (has passkey):**
1. Detect passkey availability (check count from API or local cache)
2. Show "Sign in" — runs passkey auth directly
3. If passkey fails/cancelled → falls back to OneAuth

### Signed-in UI

- Identity card: name + certified badge
- Passkey count + "Add passkey" if zero
- Recovery key status + inline setup if not configured
- "Manage on glue.one" link
- "Sign out" action

### Sign Out

- Disables sync, clears cert state
- Sets FedCM login status to `logged-out`
- Does NOT delete local ONE.core instance (data stays on device)

### Recovery (inline, post-sign-in)

When signed in and no recovery key configured:
- Collapsed hint: "Set up photo recovery"
- Expands to existing photo+PIN flow (pick photos, arrange, enter date, derive key)
- On success: status updates to "Recovery key: configured"

When recovery IS configured:
- Status line + "Change recovery key" action

Same `RecoverySecretSection` logic, rendered inline within fotos id instead of as a separate collapsible.

### What Gets Removed

- **Sync section** — sign-in implies sync, sign-out disables it
- **Identity section** — absorbed into fotos id
- **Recovery section** — absorbed into fotos id, shown after sign-in
- Standalone sync toggle disappears; replaced by sign-in/sign-out

### What Stays

- `authenticateWithPasskeyViaPopup` — called from the new flow when passkey is available
- `OneAuth` class from auth.core — primary sign-in mechanism
- "Learn more about glue.one" and "Manage on glue.one" footer links
- All photo key derivation logic unchanged

---

## Implementation

### Task 1: Refactor FotosSettings into single fotos id section

**File:** `fotos.browser/browser-ui/src/components/FotosSettings.tsx`

Remove the three `CollapsibleSection` wrappers (Sync, Identity, Recovery). Replace with a single component that renders based on cert state:

- **Signed out**: "Sign in with ONE" button
- **Signed in**: identity card + recovery inline

The sync toggle logic moves into the sign-in/sign-out handlers:
- Sign in success → `updateSection({ moduleId: 'glue', values: { syncEnabled: true } })` + reload
- Sign out → `updateSection({ moduleId: 'glue', values: { syncEnabled: false } })` + reload

### Task 2: Add OneAuth sign-in path

**Files:**
- `fotos.browser/browser-ui/src/components/FotosSettings.tsx`
- `fotos.browser/browser-ui/package.json` (add `@glueone/auth.core` if not present)

Add `handleSignIn` that:
1. Checks passkey count (from state, loaded on mount)
2. If passkeys > 0 → call `authenticateWithPasskeyViaPopup`
3. If no passkeys or passkey fails → `new OneAuth().login({ popup: true })`
4. On success → enable sync, set certified state, set FedCM login status

### Task 3: Add passkey save prompt after OneAuth sign-in

**File:** `fotos.browser/browser-ui/src/components/FotosSettings.tsx`

After successful OneAuth authentication (not passkey):
- Show inline prompt: "Save a passkey for faster sign-in?" with [Save] [Skip]
- Save triggers the existing glue.one passkey registration popup flow
- Skip dismisses the prompt
- Store dismissal in localStorage so it doesn't nag every session

### Task 4: Add sign-out action

**File:** `fotos.browser/browser-ui/src/components/FotosSettings.tsx`

Small "Sign out" button at bottom of signed-in state:
- Calls `updateSection({ moduleId: 'glue', values: { syncEnabled: false } })`
- Sets FedCM login status to `logged-out`
- Reloads page

### Task 5: Inline recovery into fotos id section

**File:** `fotos.browser/browser-ui/src/components/FotosSettings.tsx`

Move `RecoverySecretSection` rendering from a standalone collapsible into the signed-in state of the fotos id section. Show only when `certState === 'certified'`. No functional changes to derivation or registration logic.

---

## Dependency Order

Tasks 1-2 must be sequential (1 restructures the component, 2 adds the new sign-in).
Tasks 3-5 are independent of each other, all depend on 1+2.

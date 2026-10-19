import {
  createBrowserCredentialVault,
  createBrowserGlueLogin,
  type BrowserGlueLoginResult,
} from '@glueone/auth.core';
import { resolveFotosBootAccount, selectFotosGlueAccount } from './fotosBootCreds.js';

type Vault = { read(issuer: string, subject: string): Promise<string | undefined> };
type GlueLogin = {
  login(options?: { loginHint?: string; signal?: AbortSignal }): Promise<BrowserGlueLoginResult>;
  resume(): Promise<BrowserGlueLoginResult | undefined>;
};

export function createFotosGlueLoginSession(auth: GlueLogin, vault: Vault) {
  let busy = false;
  return {
    async signIn(options: { loginHint?: string; signal?: AbortSignal } = {}): Promise<void> {
      if (busy) throw new Error('Glue login already in progress');
      busy = true;
      try {
        const result = await auth.login(options);
        options.signal?.throwIfAborted();
        selectFotosGlueAccount(result.identity.personId);
      } finally {
        busy = false;
      }
    },
    async resolveBoot() {
      // Remove credentials cached by the old, unverified redirect implementation.
      try { sessionStorage.removeItem('one_auth_token'); } catch {}
      const result = await auth.resume();
      // Verification and sealing finish before changing the selected account or opening ONE.
      if (result) selectFotosGlueAccount(result.identity.personId);
      const url = new URL(window.location.href);
      const accountSelector = result ? null : url.searchParams.get('fotosAccount');
      if (url.searchParams.has('fotosAccount')) {
        url.searchParams.delete('fotosAccount');
        window.history.replaceState(window.history.state, '', url.toString());
      }
      return resolveFotosBootAccount({ accountSelector, vault });
    },
  };
}

let vault: ReturnType<typeof createBrowserCredentialVault> | undefined;
// Construct the vault only when a Glue account needs it. Visitor startup remains local.
const localVault = {
  read: (issuer: string, subject: string) => (vault ??= createBrowserCredentialVault()).read(issuer, subject),
  getOrCreate: (issuer: string, subject: string) => (vault ??= createBrowserCredentialVault()).getOrCreate(issuer, subject),
};
let session: ReturnType<typeof createFotosGlueLoginSession> | undefined;
export function getFotosGlueLogin() {
  return session ??= createFotosGlueLoginSession(createBrowserGlueLogin({ vault: localVault }), localVault);
}

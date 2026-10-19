import {
  createBrowserCredentialVault,
  createBrowserGlueLogin,
  type BrowserGlueLoginResult,
} from '@glueone/auth.core';
import { resolveFotosBootAccount, selectFotosGlueAccount, type FotosCredentialVault } from './fotosBootCreds.js';

type Vault = FotosCredentialVault;
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
        await selectFotosGlueAccount(result.identity.personId, vault, { signal: options.signal });
        options.signal?.throwIfAborted();
      } finally {
        busy = false;
      }
    },
    async resolveBoot() {
      // Remove credentials cached by the old, unverified redirect implementation.
      try { sessionStorage.removeItem('one_auth_token'); } catch {}
      const result = await auth.resume();
      const url = new URL(window.location.href);
      const requested = url.searchParams.get('fotosAccount');
      // Verification and sealing finish before changing the selected account or opening ONE.
      if (result) await selectFotosGlueAccount(result.identity.personId, vault, { preservePendingCreation: requested === 'new' });
      const accountSelector = requested === 'new' ? requested : result ? null : requested;
      if (url.searchParams.has('fotosAccount')) {
        url.searchParams.delete('fotosAccount');
        window.history.replaceState(window.history.state, '', url.toString());
      }
      return resolveFotosBootAccount({ accountSelector, vault });
    },
  };
}

let vault: ReturnType<typeof createBrowserCredentialVault> | undefined;
// All local credentials use the same device vault; startup remains offline.
const localVault = {
  import: (issuer: string, subject: string, secret: string) => (vault ??= createBrowserCredentialVault()).import(issuer, subject, secret),
  read: (issuer: string, subject: string) => (vault ??= createBrowserCredentialVault()).read(issuer, subject),
  getOrCreate: (issuer: string, subject: string) => (vault ??= createBrowserCredentialVault()).getOrCreate(issuer, subject),
};
let session: ReturnType<typeof createFotosGlueLoginSession> | undefined;
export function getFotosGlueLogin() {
  return session ??= createFotosGlueLoginSession(createBrowserGlueLogin({ vault: localVault }), localVault);
}

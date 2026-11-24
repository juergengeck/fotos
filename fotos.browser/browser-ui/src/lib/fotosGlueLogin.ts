import {
  createBrowserCredentialVault,
  createBrowserGlueEnrollment,
  type GlueEnrollmentInput,
  type GlueEnrollmentReceipt,
} from '@glueone/auth.core';
import { resolveFotosBootAccount, selectFotosNativeGlueAccount, type FotosCredentialVault } from './fotosBootCreds.js';

type Vault = FotosCredentialVault;
type GlueEnrollment = (options: GlueEnrollmentInput) => Promise<GlueEnrollmentReceipt>;

export function createFotosGlueLoginSession(enroll: GlueEnrollment, vault: Vault) {
  let busy = false;
  return {
    async signIn(options: { loginHint?: string; signal?: AbortSignal } = {}): Promise<void> {
      if (busy) throw new Error('Glue login already in progress');
      busy = true;
      try {
        if (!options.loginHint?.trim()) throw new Error('Enter your registered glue.one name to connect this device');
        const result = await enroll({ ...options, loginHint: options.loginHint.trim() });
        options.signal?.throwIfAborted();
        await selectFotosNativeGlueAccount(result, vault, { signal: options.signal });
        options.signal?.throwIfAborted();
      } finally {
        busy = false;
      }
    },
    async resolveBoot() {
      // Remove credentials cached by the old, unverified redirect implementation.
      try { sessionStorage.removeItem('one_auth_token'); } catch {}
      const url = new URL(window.location.href);
      if (url.searchParams.has('one_token')) {
        url.searchParams.delete('one_token');
        window.history.replaceState(window.history.state, '', url.toString());
        throw new Error('Legacy Glue login callback cannot enroll this device; sign in again');
      }
      const requested = url.searchParams.get('fotosAccount');
      const accountSelector = requested;
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
  return session ??= createFotosGlueLoginSession(createBrowserGlueEnrollment({ instanceNamePrefix: 'fotos' }), localVault);
}

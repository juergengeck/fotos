import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  createMobileCanonicalGlueSession,
  createMobileCredentialVault,
  createMobileGlueEnrollment,
  createMobileGlueLogin,
  mobileCanonicalGlueCredentials,
  type GlueEnrollmentReceipt,
  type MobileCanonicalGlueCredentials,
} from '@glueone/auth.core/mobile';
import appConfig from '../../app.json';

const CLIENT_ID = 'https://fotos.one' as const;
const trustedAuthorityRootPublicKeys: readonly string[] =
  appConfig.expo.extra.glueAuthorityRootPublicKeys;

const randomHex = () =>
  Array.from(Crypto.getRandomBytes(32), byte => byte.toString(16).padStart(2, '0')).join('');

const store = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const vault = createMobileCredentialVault(store, randomHex);
const canonicalSession = createMobileCanonicalGlueSession(store);

export const loginWithGlue = createMobileGlueLogin({
  clientId: CLIENT_ID,
  randomHex,
  vault,
  openAuthSession: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
  dismissAuthSession: () => {
    WebBrowser.dismissAuthSession();
  },
  verifyOptions: { trustedAuthorityRootPublicKeys },
});

export const enrollWithGlue = createMobileGlueEnrollment({
  clientId: CLIENT_ID,
  trustedAuthorityRootPublicKeys,
  openAuthSession: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
  dismissAuthSession: () => {
    WebBrowser.dismissAuthSession();
  },
});

export const prepareGlueSession = canonicalSession.prepare;
export const rememberGlueSession = canonicalSession.remember;
export const clearGlueSession = canonicalSession.clear;
export const forgetGlueSubject = canonicalSession.forget;
export const readGlueSession = canonicalSession.read;
export const findEnrolledGlueAccount = canonicalSession.findByIdentity;

export type MobileGlueAuthOutcome =
  | { kind: 'existing'; credentials: MobileCanonicalGlueCredentials }
  | { kind: 'enrolled'; credentials: MobileCanonicalGlueCredentials; receipt: GlueEnrollmentReceipt };

export async function signInWithGlueCanonical(options: {
  loginHint?: string;
  signal?: AbortSignal;
  hasLocalInstance: (instanceName: string, email: string) => Promise<boolean>;
}): Promise<MobileGlueAuthOutcome | null> {
  const trimmedHint = options.loginHint?.trim() ?? '';

  if (trimmedHint) {
    const existing = await canonicalSession.findByIdentity(trimmedHint).catch(() => null);
    if (existing && (await options.hasLocalInstance(existing.instanceName, existing.email))) {
      const verified = await loginWithGlue({ signal: options.signal, loginHint: existing.identity });
      if (!verified) return null;
      if (verified.identity.personId === existing.personId) {
        return { kind: 'existing', credentials: existing };
      }
      const matched = await canonicalSession.readSubject(verified.identity.personId).catch(() => null);
      if (matched && (await options.hasLocalInstance(matched.instanceName, matched.email))) {
        return { kind: 'existing', credentials: matched };
      }
      if (!verified.identity.displayName?.trim()) {
        throw new Error('glue.one returned an identity without a handle. Enter your handle@glue.one to enroll.');
      }
      const receipt = await enrollWithGlue({
        loginHint: verified.identity.displayName,
        signal: options.signal,
      });
      if (!receipt) return null;
      return { kind: 'enrolled', credentials: mobileCanonicalGlueCredentials(receipt), receipt };
    }

    const receipt = await enrollWithGlue({ loginHint: trimmedHint, signal: options.signal });
    if (!receipt) return null;
    return { kind: 'enrolled', credentials: mobileCanonicalGlueCredentials(receipt), receipt };
  }

  // Blank field: discoverable passkey pick via one-auth.html first.
  const verified = await loginWithGlue({ signal: options.signal });
  if (!verified) return null;
  const existing = await canonicalSession.readSubject(verified.identity.personId).catch(() => null);
  if (existing && (await options.hasLocalInstance(existing.instanceName, existing.email))) {
    return { kind: 'existing', credentials: existing };
  }
  if (!verified.identity.displayName?.trim()) {
    throw new Error('glue.one returned an identity without a handle. Enter your handle@glue.one to enroll.');
  }
  const receipt = await enrollWithGlue({
    loginHint: verified.identity.displayName,
    signal: options.signal,
  });
  if (!receipt) return null;
  return { kind: 'enrolled', credentials: mobileCanonicalGlueCredentials(receipt), receipt };
}

export async function restoreGlueSession(
  login: (credentials: MobileCanonicalGlueCredentials) => Promise<void>,
): Promise<MobileCanonicalGlueCredentials | null> {
  const saved = await canonicalSession.read();
  if (!saved) return null;
  await login(saved);
  return saved;
}

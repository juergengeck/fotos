import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {createMobileCredentialVault, createMobileGlueLogin, createMobileGlueSession} from '@glueone/auth.core/mobile';

const randomHex = () => Array.from(Crypto.getRandomBytes(32), byte => byte.toString(16).padStart(2, '0')).join('');
const store = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
const vault = createMobileCredentialVault(store, randomHex);
const session = createMobileGlueSession(store, vault);

export const rememberGlueSession = session.remember;
export const prepareGlueSession = session.prepare;
export const clearGlueSession = session.clear;
export async function restoreGlueSession(login: (localName: string, secret: string) => Promise<void>): Promise<boolean> {
  const saved = await session.read();
  if (!saved) return false;
  await login(saved.localName, saved.secret);
  return true;
}

export const loginWithGlue = createMobileGlueLogin({
  clientId: 'https://fotos.one',
  randomHex,
  vault,
  openAuthSession: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
  dismissAuthSession: () => { WebBrowser.dismissAuthSession(); },
});

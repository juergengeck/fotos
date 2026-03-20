// Browser shim for @refinio/one.core/lib/system/crypto-helpers.js
// Used by trie.core's hash.ts — provides createCryptoHash via Web Crypto API

export async function createCryptoHash(s: string): Promise<string> {
    const data = new TextEncoder().encode(s);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

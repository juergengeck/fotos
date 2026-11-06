interface BrowserCryptoSupportSnapshot {
    hasCrypto: boolean;
    hasSubtle: boolean;
    isSecureContext: boolean;
    protocol: string;
    hostname: string;
    origin: string;
}

interface BrowserCryptoSupport {
    supported: boolean;
    message: string | null;
}

export function isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    return normalized === 'localhost'
        || normalized.endsWith('.localhost')
        || normalized === '127.0.0.1'
        || normalized.startsWith('127.')
        || normalized === '[::1]'
        || normalized === '::1';
}

export function evaluateBrowserCryptoSupport(
    snapshot: BrowserCryptoSupportSnapshot,
): BrowserCryptoSupport {
    if (snapshot.hasSubtle) {
        return { supported: true, message: null };
    }

    if (!snapshot.hasCrypto) {
        return {
            supported: false,
            message: 'This browser session has no Web Crypto API. fotos needs crypto.subtle for ONE.core storage and local hashing.',
        };
    }

    const missingSubtleMessage = 'This browser session does not expose crypto.subtle. fotos needs it for ONE.core storage and local hashing.';

    if (snapshot.protocol === 'http:' && !isLoopbackHostname(snapshot.hostname)) {
        return {
            supported: false,
            message: `${missingSubtleMessage} Safari typically only enables it on HTTPS or loopback hosts, and this page is running on plain HTTP at ${snapshot.origin}. Use HTTPS or open the app on localhost.`,
        };
    }

    if (!snapshot.isSecureContext) {
        return {
            supported: false,
            message: `${missingSubtleMessage} Use HTTPS or a loopback host such as localhost.`,
        };
    }

    return {
        supported: false,
        message: missingSubtleMessage,
    };
}

export function getRuntimeBrowserCryptoSupport(): BrowserCryptoSupport {
    const cryptoObject = typeof globalThis.crypto === 'object' ? globalThis.crypto : undefined;
    const hasSubtle = typeof cryptoObject?.subtle !== 'undefined';
    const locationObject = typeof globalThis.location === 'object'
        ? globalThis.location
        : { protocol: '', hostname: '', origin: '' };

    return evaluateBrowserCryptoSupport({
        hasCrypto: typeof cryptoObject !== 'undefined',
        hasSubtle,
        isSecureContext: globalThis.isSecureContext ?? false,
        protocol: locationObject.protocol,
        hostname: locationObject.hostname,
        origin: locationObject.origin,
    });
}

export type { BrowserCryptoSupport, BrowserCryptoSupportSnapshot };

import { describe, expect, it } from 'vitest';
import { evaluateBrowserCryptoSupport, isLoopbackHostname } from './browserCryptoSupport.js';

describe('isLoopbackHostname', () => {
    it('accepts localhost and loopback addresses', () => {
        expect(isLoopbackHostname('localhost')).toBe(true);
        expect(isLoopbackHostname('dev.localhost')).toBe(true);
        expect(isLoopbackHostname('127.0.0.1')).toBe(true);
        expect(isLoopbackHostname('127.0.0.42')).toBe(true);
        expect(isLoopbackHostname('[::1]')).toBe(true);
    });

    it('rejects non-loopback hosts', () => {
        expect(isLoopbackHostname('192.168.0.10')).toBe(false);
        expect(isLoopbackHostname('fotos.local')).toBe(false);
    });
});

describe('evaluateBrowserCryptoSupport', () => {
    it('allows supported runtimes through', () => {
        expect(evaluateBrowserCryptoSupport({
            hasCrypto: true,
            hasSubtle: true,
            isSecureContext: true,
            protocol: 'https:',
            hostname: 'fotos.one',
            origin: 'https://fotos.one',
        })).toEqual({
            supported: true,
            message: null,
        });
    });

    it('explains the Safari plain-http case clearly', () => {
        const result = evaluateBrowserCryptoSupport({
            hasCrypto: true,
            hasSubtle: false,
            isSecureContext: false,
            protocol: 'http:',
            hostname: '192.168.0.10',
            origin: 'http://192.168.0.10:5188',
        });

        expect(result.supported).toBe(false);
        expect(result.message).toContain('crypto.subtle');
        expect(result.message).toContain('HTTPS');
        expect(result.message).toContain('localhost');
        expect(result.message).toContain('http://192.168.0.10:5188');
    });

    it('falls back to a generic secure-context hint on loopback', () => {
        const result = evaluateBrowserCryptoSupport({
            hasCrypto: true,
            hasSubtle: false,
            isSecureContext: false,
            protocol: 'http:',
            hostname: 'localhost',
            origin: 'http://localhost:5188',
        });

        expect(result.supported).toBe(false);
        expect(result.message).toContain('loopback host');
    });
});

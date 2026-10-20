import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetGlueCertification, rememberGlueCertification, resolveGlueCertificationState } from './glueCertification';

describe('resolveGlueCertificationState', () => {
    beforeEach(() => {
        const saved = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => saved.get(key) ?? null,
            setItem: (key: string, value: string) => saved.set(key, value),
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    const cert = {
        claims: { identity: 'gecko@glue.one' },
        subjectPublicKey: 'abc123',
        validUntil: Date.UTC(2030, 0, 2),
    };

    function offlineOptions(overrides = {}) {
        return {
            publicationIdentity: 'person-1' as any,
            displayName: 'Gecko',
            fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
            now: Date.UTC(2030, 0, 1),
            resolvePublicSignKeyHex: async () => 'abc123',
            ...overrides,
        };
    }

    it('restores the successful popup login when the server cannot be reached', async () => {
        await rememberGlueCertification('person-1' as any, 'Gecko', cert, async () => 'abc123');
        expect((await resolveGlueCertificationState(offlineOptions())).certState).toBe('certified');
    });

    it('does not reuse a saved login for another account, handle, key, or after expiry', async () => {
        await rememberGlueCertification('person-1' as any, 'Gecko', cert, async () => 'abc123');
        for (const overrides of [
            { publicationIdentity: 'person-2' },
            { displayName: 'Alice' },
            { resolvePublicSignKeyHex: async () => 'other-key' },
            { now: Date.UTC(2030, 0, 3) },
        ]) {
            expect((await resolveGlueCertificationState(offlineOptions(overrides))).certState).toBe('anchored');
        }
    });

    it('does not remember a popup certificate belonging to another local key', async () => {
        await rememberGlueCertification('person-1' as any, 'Gecko', cert, async () => 'other-key');
        expect((await resolveGlueCertificationState(offlineOptions())).certState).toBe('anchored');
    });

    it('keeps the remembered login on server failures and clears it on explicit sign out', async () => {
        await rememberGlueCertification('person-1' as any, 'Gecko', cert, async () => 'abc123');
        expect((await resolveGlueCertificationState(offlineOptions({
            fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
        }))).certState).toBe('certified');
        forgetGlueCertification('person-1' as any);
        expect((await resolveGlueCertificationState(offlineOptions())).certState).toBe('anchored');
    });

    it('clears the remembered login when the server no longer certifies that key', async () => {
        await rememberGlueCertification('person-1' as any, 'Gecko', cert, async () => 'abc123');
        const result = await resolveGlueCertificationState(offlineOptions({
            fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 404 })),
        }));
        expect(result.certState).toBe('anchored');
        expect((await resolveGlueCertificationState(offlineOptions())).certState).toBe('anchored');
    });

    it('remembers a certificate fetched successfully for later offline restoration', async () => {
        await resolveGlueCertificationState(offlineOptions({
            fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { cert } }))),
        }));
        expect((await resolveGlueCertificationState(offlineOptions())).certState).toBe('certified');
    });

    it('certifies only when the local public key maps to the expected glue identity', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: {
                cert: {
                    claims: {
                        identity: 'gecko@glue.one',
                    },
                    validUntil: Date.UTC(2030, 0, 2),
                },
            },
        }), { status: 200 }));

        const result = await resolveGlueCertificationState({
            publicationIdentity: 'person-1' as any,
            displayName: 'Gecko',
            fetchImpl,
            apiBase: 'https://api.glue.one',
            now: Date.UTC(2030, 0, 1),
            resolvePublicSignKeyHex: async () => 'abc123',
        });

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://api.glue.one/api/registration/certByPublicKey/abc123',
        );
        expect(result.certState).toBe('certified');
        expect(result.certValidUntil).toBe(new Date(Date.UTC(2030, 0, 2)).toLocaleDateString());
    });

    it('does not mark the browser authenticated when no cert exists for the local public key', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));

        const result = await resolveGlueCertificationState({
            publicationIdentity: 'person-1' as any,
            displayName: 'Gecko',
            fetchImpl,
            apiBase: 'https://api.glue.one',
            resolvePublicSignKeyHex: async () => 'missing-key',
        });

        expect(result).toEqual({
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex: 'missing-key',
        });
    });

    it('treats a cert for a different glue handle as anchored', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: {
                cert: {
                    claims: {
                        identity: 'oldname@glue.one',
                    },
                    validUntil: Date.UTC(2030, 0, 2),
                },
            },
        }), { status: 200 }));

        const result = await resolveGlueCertificationState({
            publicationIdentity: 'person-1' as any,
            displayName: 'New Name',
            fetchImpl,
            apiBase: 'https://api.glue.one',
            now: Date.UTC(2030, 0, 1),
            resolvePublicSignKeyHex: async () => 'abc123',
        });

        expect(result).toEqual({
            certState: 'anchored',
            certValidUntil: null,
            publicKeyHex: 'abc123',
        });
    });
});

import { describe, expect, it, vi } from 'vitest';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { resolveGlueCertificationState } from './glueCertification';

describe('resolveGlueCertificationState', () => {
    it.each([
        ['gecko@glue.one', 'gecko@glue.one', 'certified'],
        ['Alice-Smith@glue.one', 'alice-smith@glue.one', 'certified'],
        ['alice-smith', 'alicesmith@glue.one', 'anchored'],
        ['alicesmith', 'alice-smith@glue.one', 'anchored'],
        ['gecko', 'gecko@other.one', 'anchored'],
        ['ab', 'a+b@glue.one', 'anchored'],
    ])('compares the requested %s with the complete certified account %s', async (displayName, identity, certState) => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: { cert: { claims: { identity }, validUntil: Date.UTC(2030, 0, 2) } },
        }), { status: 200 }));
        const result = await resolveGlueCertificationState({
            publicationIdentity: 'person-1' as SHA256IdHash<Person>,
            displayName, fetchImpl, now: Date.UTC(2030, 0, 1),
            resolvePublicSignKeyHex: async () => 'abc123',
        });
        expect(result.certState).toBe(certState);
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

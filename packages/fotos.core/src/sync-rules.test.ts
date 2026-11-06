import {describe, expect, it} from 'vitest';
import {SyncFilterFactory} from '@refinio/sync.core/services/SyncFilterFactory.js';
import {contentRules} from '@refinio/sync.core/rules/default-rules.js';
import type {EffectivePersonalTrust} from '@refinio/trust.core/types/personal-trust.js';
import type {TrustLevel} from '@refinio/trust.core/types/trust-types.js';
import {fotosContentRules} from './sync-rules.js';

const chain = {
    $type$: 'FotosShareCertificateChain',
    $version$: 'v1',
    id: 'fotos-share-certificate-chain:v1:sender:tv:gallery:fotos',
    issuer: 'sender',
    subject: 'tv',
    scopeKind: 'gallery',
    scopeId: 'fotos',
    certificate: 'certificate-hash',
    signature: 'signature-hash',
};

const manifest = {
    $type$: 'FotosShareManifest',
    id: 'fotos-share-manifest:v1:sender:gallery:fotos',
    issuer: 'sender',
    scopeKind: 'gallery',
    scopeId: 'fotos',
    entries: new Set(['entry-hash']),
    snapshotObjects: new Set(['entry-hash']),
    snapshotIds: new Set(['sender']),
    snapshotBlobs: new Set(['photo-blob']),
    snapshotOrder: ['object:entry-hash', 'id:sender', 'blob:photo-blob'],
};

function importFilter(trustLevel: TrustLevel, rules = fotosContentRules) {
    const factory = new SyncFilterFactory({rules});
    factory.preparePeerTrust('sender', {
        kind: 'personal',
        projection: {
            owner: 'tv',
            subject: 'sender',
            scope: 'personal',
            trustLevel,
            state: 'effective',
            sourceKind: 'direct',
            projectionHash: `trust:${trustLevel}`,
            sourceBundleHashes: ['trust-evidence'],
        } as EffectivePersonalTrust,
    });
    return factory.createImportFilter('sender');
}

describe('Fotos root admission through SyncFilterFactory', () => {
    it('admits shared manifest and certificate chain roots that generic content rules deny', async () => {
        const genericFilter = importFilter('trusted', contentRules);
        const fotosFilter = importFilter('trusted');
        for (const root of [chain, manifest]) {
            expect(await genericFilter('root-hash', root.$type$, root, 'object')).toBe(false);
            expect(await fotosFilter('root-hash', root.$type$, root, 'object')).toBe(true);
            expect(await fotosFilter('root-id-hash', root.$type$, {
                $type$: root.$type$,
                id: root.id,
            }, 'id')).toBe(true);
        }
    });

    it('denies full and ID-only Fotos roots from ignored peers', async () => {
        const filter = importFilter('ignore');
        for (const root of [chain, manifest]) {
            expect(await filter('root-hash', root.$type$, root, 'object')).toBe(false);
            expect(await filter('root-id-hash', root.$type$, {
                $type$: root.$type$,
                id: root.id,
            }, 'id')).toBe(false);
        }
    });

    it.each([
        {label: 'entry omitted from closure', changes: {snapshotObjects: new Set()}},
        {label: 'issuer omitted from closure', changes: {snapshotIds: new Set(['someone-else'])}},
        {label: 'missing closure order entry', changes: {snapshotOrder: ['object:entry-hash', 'id:sender']}},
        {label: 'duplicate closure order entry', changes: {snapshotOrder: ['object:entry-hash', 'id:sender', 'id:sender']}},
        {label: 'unknown closure order entry', changes: {snapshotOrder: ['object:entry-hash', 'id:sender', 'blob:other']}},
        {label: 'incorrect deterministic identity', changes: {id: 'fotos-share-manifest:v1:other:gallery:fotos'}},
    ])('denies a manifest with $label', async ({changes}) => {
        const filter = importFilter('trusted');
        expect(await filter('manifest-hash', manifest.$type$, {...manifest, ...changes}, 'object')).toBe(false);
    });

    it('denies an inconsistent certificate chain and preserves generic Signature policy', async () => {
        const filter = importFilter('trusted');
        expect(await filter('chain-hash', chain.$type$, {...chain, subject: 'someone-else'}, 'object')).toBe(false);
        expect(fotosContentRules.get('Signature')).toBe(contentRules.get('Signature'));
        expect(fotosContentRules.get('*')).toBe(contentRules.get('*'));
    });
});

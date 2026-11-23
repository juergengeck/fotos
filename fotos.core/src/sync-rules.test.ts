import {describe, expect, it} from 'vitest';
import {SyncFilterFactory} from '@refinio/sync.core/services/SyncFilterFactory.js';
import {contentRules} from '@refinio/sync.core/rules/default-rules.js';
import type {EffectivePersonalTrust} from '@refinio/trust.core/types/personal-trust.js';
import type {TrustLevel} from '@refinio/trust.core/types/trust-types.js';
import {canImportFotosEntry, canImportFotosManifest, fotosContentRules} from './sync-rules.js';
import {getOwnedFotosManifestId} from './owned-fotos-manifest.js';
import {createFotosAlbumCollection} from './fotos-collection.js';

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
    const owner = 'a'.repeat(64);
    const otherOwner = 'b'.repeat(64);
    const ownedRoot = {$type$: 'FotosManifest', id: getOwnedFotosManifestId(owner), entries: new Set(['entry-hash'])};

    it('admits full and ID-only scoped roots for the exact authenticated owner self lane', async () => {
        const factory = new SyncFilterFactory({rules: fotosContentRules});
        factory.preparePeerTrust(owner, {kind: 'self', ownerId: owner});
        const filter = factory.createImportFilter(owner);
        expect(await filter('owned-version', 'FotosManifest', ownedRoot, 'object')).toBe(true);
        expect(await filter('owned-id', 'FotosManifest', {$type$: 'FotosManifest', id: ownedRoot.id}, 'id')).toBe(true);
    });

    it('denies another scoped owner even on an accepted self lane', async () => {
        const factory = new SyncFilterFactory({rules: fotosContentRules});
        factory.preparePeerTrust(otherOwner, {kind: 'self', ownerId: otherOwner});
        const filter = factory.createImportFilter(otherOwner);
        expect(await filter('foreign-version', 'FotosManifest', ownedRoot, 'object')).toBe(false);
        expect(await filter('foreign-id', 'FotosManifest', {$type$: 'FotosManifest', id: ownedRoot.id}, 'id')).toBe(false);
    });

    it('admits album membership for the owner without making it part of the media ID', async () => {
        const source = {owner, libraryId: 'c'.repeat(64), albumId: 'Photos/L0/001', photoHashes: ['d'.repeat(64)]};
        const album = createFotosAlbumCollection({...source, name: 'Trip'});
        expect(createFotosAlbumCollection({...source, name: 'Summer Trip'}).id).toBe(album.id);
        expect(createFotosAlbumCollection({...source, name: 'Trip', libraryId: 'e'.repeat(64)}).id).not.toBe(album.id);
        const factory = new SyncFilterFactory({rules: fotosContentRules});
        factory.preparePeerTrust(owner, {kind: 'self', ownerId: owner});
        factory.preparePeerTrust(otherOwner, {kind: 'self', ownerId: otherOwner});
        const filter = factory.createImportFilter(owner);
        const root = {...ownedRoot, collections: new Set(['f'.repeat(64)])};
        expect(await filter('album', 'FotosCollection', album, 'object')).toBe(true);
        expect(await filter('album-id', 'FotosCollection', {$type$: 'FotosCollection', id: album.id}, 'id')).toBe(true);
        expect(await filter('bad-album', 'FotosCollection', {...album, photoHashes: new Set(['filename.png'])}, 'object')).toBe(false);
        expect(await filter('album-root', 'FotosManifest', root, 'object')).toBe(true);
        expect(await filter('legacy-album-root', 'FotosManifest', {...root, id: 'fotos'}, 'object')).toBe(false);
        const otherFilter = factory.createImportFilter(otherOwner);
        expect(await otherFilter('foreign-album', 'FotosCollection', album, 'object')).toBe(false);
    });

    it('accepts bounded gallery metadata while validating its values', () => {
        const context = {peerTrustLevel: 'trusted' as const};
        const entry = {$type$: 'FotosEntry', contentHash: 'content', streamId: 'stream', mime: 'image/png', size: 42};
        const metadata = {duration: 3.2, favorite: true, mediaSubtypes: new Set(['live-photo']),
            orientation: 8, exifGpsAlt: -10, originalFilename: 'image.png'};
        expect(canImportFotosEntry(context, entry)).toBe(true);
        expect(canImportFotosEntry(context, {...entry, ...metadata})).toBe(true);
        expect(canImportFotosEntry(context, {...entry, duration: -1})).toBe(false);
        expect(canImportFotosEntry(context, {...entry, favorite: 'true'})).toBe(false);
        expect(canImportFotosEntry(context, {...entry, orientation: 9})).toBe(false);
        expect(canImportFotosEntry(context, {...entry, mediaSubtypes: new Set(['unknown'])})).toBe(false);
    });

    it.each([false, true])('denies external personal-trust admission even when IoM promotion is %s', async iom => {
        const factory = new SyncFilterFactory({rules: fotosContentRules});
        factory.preparePeerTrust(owner, {kind: 'personal', projection: {
            owner: otherOwner, subject: owner, scope: 'personal', trustLevel: 'trusted', state: 'effective',
            sourceKind: 'direct', projectionHash: 'trust-evidence', sourceBundleHashes: ['trust-source'],
        } as EffectivePersonalTrust});
        const filter = factory.createImportFilter(owner, async () => iom);
        expect(await filter('external-version', 'FotosManifest', ownedRoot, 'object')).toBe(false);
        expect(await filter('external-id', 'FotosManifest', {$type$: 'FotosManifest', id: ownedRoot.id}, 'id')).toBe(false);
    });

    it('denies scoped roots with missing owner facts, ignored trust, or noncanonical authenticated ids', () => {
        expect(canImportFotosManifest({peerTrustLevel: 'me', remotePersonId: owner}, ownedRoot)).toBe(false);
        expect(canImportFotosManifest({peerTrustLevel: 'me', remotePersonId: owner,
            peerTrust: {kind: 'self', ownerId: otherOwner}}, ownedRoot)).toBe(false);
        expect(canImportFotosManifest({peerTrustLevel: 'ignore', remotePersonId: owner,
            peerTrust: {kind: 'self', ownerId: owner}}, ownedRoot)).toBe(false);
        expect(canImportFotosManifest({peerTrustLevel: 'me', remotePersonId: owner.toUpperCase(),
            peerTrust: {kind: 'self', ownerId: owner.toUpperCase()}}, ownedRoot)).toBe(false);
    });

    it('continues to validate scoped version payloads rather than treating a missing payload as an ID object', async () => {
        const factory = new SyncFilterFactory({rules: fotosContentRules});
        factory.preparePeerTrust(owner, {kind: 'self', ownerId: owner});
        const filter = factory.createImportFilter(owner);
        expect(await filter('bad-version', 'FotosManifest', {...ownedRoot, entries: ['entry-hash']}, 'object')).toBe(false);
        expect(await filter('bad-version', 'FotosManifest', {...ownedRoot, entries: undefined, extra: true}, 'object')).toBe(false);
        expect(await filter('missing-payload', 'FotosManifest', {$type$: 'FotosManifest', id: ownedRoot.id}, 'object')).toBe(false);
        expect(await filter('missing-version', 'FotosManifest', undefined, 'object')).toBe(false);
        expect(await filter('wrong-namespace', 'FotosManifest', {...ownedRoot, id: `fotos:${owner}:extra`}, 'object')).toBe(false);
    });

    it('preserves both legacy root forms for existing non-native accounts', async () => {
        const filter = importFilter('low');
        expect(await filter('legacy-version', 'FotosManifest', {...ownedRoot, id: 'fotos'}, 'object')).toBe(true);
        expect(await filter('legacy-id', 'FotosManifest', {$type$: 'FotosManifest', id: 'fotos'}, 'id')).toBe(true);
    });

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

// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {EMBEDDING_DIM, FaceClusterDimension, facesToDataAttrs} from '@refinio/fotos.core';
import {File as NodeFile} from 'node:buffer';
import {hashImageFile} from '@/lib/browserIngest';
import type {PhotoEntry} from '@/types/fotos';

const hooks = vi.hoisted(() => ({useState: vi.fn(), useRef: vi.fn()}));
vi.mock('react', () => ({
    useState: hooks.useState, useRef: hooks.useRef,
    useCallback: (value: unknown) => value, useMemo: (factory: () => unknown) => factory(), useEffect: () => {},
}));
vi.mock('@/lib/fotos-sync', () => ({
    syncPhotosToOneCore: vi.fn(), listenForFotosUpdates: vi.fn(), extractFaceDataFromEntry: vi.fn(), extractThumbUrlFromEntry: vi.fn(), writeFaceCropsToFilesystem: vi.fn(),
}));
vi.mock('@/lib/platform', () => ({isMobile: () => false}));
vi.mock('@/lib/hangTrace', () => ({traceHang: vi.fn()}));
vi.mock('@/workers/face.worker.ts?worker&url', () => ({default: 'face-worker'}));
vi.mock('@/workers/semantic.worker.ts?worker&url', () => ({default: 'semantic-worker'}));

import {useFolderAccess} from './useFolderAccess';

async function fixture(options: {missingRow?: boolean; faceFailure?: boolean; semanticFailure?: boolean; changedSource?: boolean; staleCache?: boolean; secondPhoto?: boolean; failIndexWrite?: number} = {}) {
    const embedding = Array.from({length: EMBEDDING_DIM}, (_, index) => index === 0 ? 1 : 0);
    const result = {faces: [{detection: {bbox: [0, 0, 40, 40] as [number, number, number, number], score: 0.99, landmarks: []}, embedding}]};
    const dimension = new FaceClusterDimension();
    const clusterId = dimension.assign(embedding, 'photo', 0);
    if (options.secondPhoto) dimension.assign(embedding, 'photo2', 0);
    dimension.nameCluster(clusterId, 'Ada');
    const faces = {
        count: 1, bboxes: result.faces.map(face => face.detection.bbox), scores: [0.9], embeddings: Float32Array.from(embedding), crops: [],
        clusterIds: [clusterId], names: ['Ada'], personIds: ['person-ada'],
    };
    const semantic = {modelId: 'model', embedding: new Float32Array([1, 0])};
    const photo = {hash: 'photo', sourcePath: 'family.jpg', name: 'family.jpg', mimeType: 'image/jpeg', managed: 'metadata', tags: [], addedAt: '2026-01-01', size: 123, faces, semantic} as PhotoEntry;
    const source = new NodeFile(['image bytes'], 'family.jpg') as unknown as File;
    const contentHash = await hashImageFile(source);
    const attrs = facesToDataAttrs(result, [{clusterId, personName: 'Ada', personId: 'person-ada'}]);
    let html = `<html><body><table><tr class="fs-entry" data-stream-id="${options.missingRow ? 'other' : 'photo'}" data-content-hash="${contentHash}" ${Object.entries(attrs).map(([name, value]) => `data-${name}="${value}"`).join(' ')} data-semantic-model-id="model" data-semantic-embedding="AACAPwAAAAA="><td class="fs-faces">Ada</td></tr></table></body></html>`;
    if (options.secondPhoto) html = html.replace('</table>', `<tr class="fs-entry" data-stream-id="photo2" data-content-hash="${contentHash}" ${Object.entries(attrs).map(([name, value]) => `data-${name}="${value}"`).join(' ')}><td class="fs-faces">Ada</td></tr></table>`);
    let indexWrites = 0;
    const writes: string[] = [];
    let duringIndexWrite: (() => void) | undefined;
    let clusterJson = dimension.serialize();
    if (options.staleCache) {
        const stale = JSON.parse(clusterJson);
        stale.clusters[0].members[0].faceIndex = 1;
        stale.clusters[0].centroid = embedding.map(value => -value);
        clusterJson = JSON.stringify(stale);
    }
    const getFileHandle = vi.fn(async (name: string) => ({
        getFile: async () => name === 'index.html' ? {text: async () => html} : name === 'clusters.json' ? {text: async () => clusterJson} : options.changedSource ? new NodeFile(['changed image bytes'], name) : source,
        createWritable: async () => ({
            write: async (value: string) => {if (name === 'index.html') {indexWrites++; if (indexWrites === options.failIndexWrite) throw new Error('Second row write denied'); const callback = duringIndexWrite; duringIndexWrite = undefined; callback?.(); html = value; writes.push(value);} else if (name === 'clusters.json') clusterJson = value;},
            close: async () => {},
        }),
    }));
    const handle = {name: 'library', getFileHandle, getDirectoryHandle: async () => handle, removeEntry: vi.fn()} as unknown as FileSystemDirectoryHandle;
    const photos = options.secondPhoto ? [photo, {...photo, hash: 'photo2', sourcePath: 'second.jpg', name: 'second.jpg'}] : [photo];
    const folder = {id: 'folder', label: 'library', entries: photos, handle, isCurrent: true};
    const analyze = vi.fn(async () => {
        expect(html).toContain('data-face-count="1"'); // No destructive pre-clear before inference.
        expect(photo.faces).toBe(faces);
        if (options.faceFailure) throw new Error('Face worker interrupted');
        return {dataAttrs: facesToDataAttrs(result), cropBlobs: []};
    });
    const embedImage = vi.fn(async () => {
        expect(html).toContain('data-semantic-model-id="model"');
        expect(photo.semantic).toBe(semantic);
        if (options.semanticFailure) throw new Error('Semantic worker interrupted');
        return {modelId: 'model', embedding: new Float32Array([0, 1])};
    });
    const states: unknown[] = [true, true, 'library', [folder], photos, false, null, null, null, true];
    const refs: unknown[] = [handle, [folder], photos, 'folder', new Map(), new Map(), new Map(), {handle: {analyze}}, null, {handle: {embedImage}}, null, null, null, options.staleCache ? null : dimension, 0.55, true];
    let stateIndex = 0;
    let refIndex = 0;
    hooks.useState.mockImplementation(initial => {
        const index = stateIndex++;
        if (index >= states.length) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value: unknown) => {states[index] = typeof value === 'function' ? value(states[index]) : value;}];
    });
    hooks.useRef.mockImplementation(initial => ({current: refIndex < refs.length ? refs[refIndex++] : initial}));
    const access = useFolderAccess({faceAnalyticsEnabled: true, semanticSearchEnabled: true});
    return {access, onNextIndexWrite: (callback: () => void) => {duringIndexWrite = callback;}, analyze, embedImage, photo, faces, semantic, writes, html: () => html, clusterState: () => JSON.parse(clusterJson), livePhoto: () => (states[4] as PhotoEntry[])[0], livePhotos: () => states[4] as PhotoEntry[], error: () => states[6], handle};
}

describe('useFolderAccess retained reanalysis', () => {
    beforeEach(() => vi.clearAllMocks());

    it('forces fresh face and semantic results while retaining saved user identities', async () => {
        const test = await fixture();
        await test.access.reanalyzeFaces();
        expect(test.analyze).toHaveBeenCalledOnce();
        expect(test.embedImage).toHaveBeenCalledOnce();
        expect(test.writes).toHaveLength(2);
        expect(test.writes.every(html => html.includes('data-face-names="Ada"') && html.includes('data-face-person-ids="person-ada"'))).toBe(true);
        expect(test.photo.faces?.names).toEqual(['Ada']);
        expect(test.photo.semantic?.embedding).toEqual(new Float32Array([0, 1]));
        expect(test.handle.removeEntry).not.toHaveBeenCalled();
        expect(test.error()).toBeNull();
    });

    it('retains both accepted results and surfaces interrupted workers as failure', async () => {
        const test = await fixture({faceFailure: true, semanticFailure: true});
        const saved = test.html();
        await expect(test.access.reanalyzeFaces()).rejects.toThrow('Face worker interrupted');
        expect(test.photo.faces).toBe(test.faces);
        expect(test.photo.semantic).toBe(test.semantic);
        expect(test.html()).toBe(saved);
        expect(test.writes).toHaveLength(0);
        expect(test.error()).toContain('Semantic worker interrupted');
        expect(test.handle.removeEntry).not.toHaveBeenCalled();
    });

    it('retains a rename requested while a replacement index write is pending', async () => {
        const test = await fixture();
        let rename: Promise<void> | undefined;
        test.onNextIndexWrite(() => {rename = test.access.renameFace('photo:0', 'Grace');});
        await test.access.reanalyzeFaces();
        await rename;
        expect(test.livePhoto().faces?.names).toEqual(['Grace']);
        expect(test.livePhoto().faces?.personIds).toEqual(['person-ada']);
        expect(test.html()).toContain('data-face-names="Grace"');
        expect(test.clusterState().clusters[0].personName).toBe('Grace');
    });

    it('refuses an association for a visible face whose analysis is replaced before the edit commits', async () => {
        const test = await fixture();
        const embeddingA = Array.from({length: EMBEDDING_DIM}, (_, index) => index === 0 ? 1 : 0);
        const embeddingB = Array.from({length: EMBEDDING_DIM}, (_, index) => index === 1 ? 1 : 0);
        test.analyze.mockResolvedValueOnce({dataAttrs: facesToDataAttrs({faces: [
            {detection: {bbox: [80, 0, 120, 40], score: 0.99, landmarks: []}, embedding: embeddingB},
            {detection: {bbox: [0, 0, 40, 40], score: 0.99, landmarks: []}, embedding: embeddingA},
        ]}), cropBlobs: []});
        let association: Promise<void> | undefined;
        test.onNextIndexWrite(() => {
            association = test.access.associateFaceWithCluster('photo', 0, 'chosen-cluster');
        });
        await test.access.reanalyzeFaces();
        await association;
        expect(test.livePhoto().faces?.clusterIds).not.toContain('chosen-cluster');
        expect(test.livePhoto().faces?.names).toEqual(['Unknown', 'Ada']);
        expect(test.error()).toContain('Face analysis changed');
        const saved = new DOMParser().parseFromString(test.html(), 'text/html');
        expect(saved.querySelector('[data-stream-id="photo"]')?.getAttribute('data-face-names')).toBe('Unknown;Ada');
    });

    it('publishes each successful annotation row before a later row fails, and retains it on replacement', async () => {
        const test = await fixture({secondPhoto: true, failIndexWrite: 2});
        await expect(test.access.renameFace('photo:0', 'Grace')).rejects.toThrow('Second row write denied');
        expect(test.livePhotos()[0].faces?.names).toEqual(['Grace']);
        expect(test.livePhotos()[1].faces?.names).toEqual(['Ada']);
        const before = new DOMParser().parseFromString(test.html(), 'text/html');
        expect(before.querySelector('[data-stream-id="photo"]')?.getAttribute('data-face-names')).toBe('Grace');
        expect(before.querySelector('[data-stream-id="photo2"]')?.getAttribute('data-face-names')).toBe('Ada');
        await test.access.reanalyzeFaces();
        expect(test.livePhotos()[0].faces?.names).toEqual(['Grace']);
        const after = new DOMParser().parseFromString(test.html(), 'text/html');
        expect(after.querySelector('[data-stream-id="photo"]')?.getAttribute('data-face-names')).toBe('Grace');
    });

    it('refuses identity transfer if the source bytes no longer match the exact indexed content hash', async () => {
        const test = await fixture({changedSource: true});
        await expect(test.access.reanalyzeFaces()).rejects.toThrow('source content changed');
        expect(test.analyze).not.toHaveBeenCalled();
        expect(test.embedImage).not.toHaveBeenCalled();
        expect(test.photo.faces).toBe(test.faces);
        expect(test.photo.semantic).toBe(test.semantic);
        expect(test.writes).toHaveLength(0);
        expect(test.error()).toContain('Rescan the folder first');
    });

    it('reconstructs stale cluster membership and centroids from accepted folder rows before replacement', async () => {
        const test = await fixture({staleCache: true});
        await test.access.reanalyzeFaces();
        const cluster = test.clusterState().clusters.find((cluster: {id: string}) => cluster.id === 'photo:0');
        expect(cluster.members).toEqual([{photoHash: 'photo', faceIndex: 0}]);
        expect(cluster.centroid[0]).toBe(1);
        expect(cluster.personName).toBe('Ada');
        expect(test.photo.faces?.personIds).toEqual(['person-ada']);
    });

    it('does not publish analysis as saved when its index row is missing', async () => {
        const test = await fixture({missingRow: true});
        await expect(test.access.reanalyzeFaces()).rejects.toThrow('index row missing');
        expect(test.photo.faces).toBe(test.faces);
        expect(test.photo.semantic).toBe(test.semantic);
        expect(test.writes).toHaveLength(0);
        expect(test.error()).toContain('index row missing');
    });
});

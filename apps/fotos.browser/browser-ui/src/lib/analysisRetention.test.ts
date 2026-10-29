import {describe, expect, it, vi} from 'vitest';
import {EMBEDDING_DIM, FaceClusterDimension, facesToDataAttrs} from '@refinio/fotos.core';
import type {FaceAnalysisResult} from '@refinio/fotos.core';
import type {PhotoEntry, SemanticInfo} from '@/types/fotos';
import {queueFaceMetadataMutation, replaceFaceAnalysis, replaceSemanticAnalysis} from './analysisRetention';

const embedding = (axis = 0) => Array.from({length: EMBEDDING_DIM}, (_, index) => index === axis ? 1 : 0);
const face = (left: number, axis = 0) => ({detection: {bbox: [left, 0, left + 40, 40] as [number, number, number, number], score: 0.99, landmarks: []}, embedding: embedding(axis), cropPath: `faces/new-${left}.jpg`});

function fixture() {
    const original: FaceAnalysisResult = {faces: [face(0), face(100, 1)]};
    const dimension = new FaceClusterDimension();
    const ids = original.faces.map((face, index) => dimension.assign(face.embedding, 'photo', index));
    dimension.nameCluster(ids[0], 'Ada');
    const photo = {
        hash: 'photo', name: 'family.jpg', sourcePath: 'album/family.jpg',
        faces: {
            count: 2, bboxes: original.faces.map(face => face.detection.bbox), scores: [0.9, 0.9],
            embeddings: Float32Array.from(original.faces.flatMap(face => face.embedding)),
            crops: ['album/one/faces/old-0.jpg', 'album/one/faces/old-1.jpg'],
            clusterIds: ids, names: ['Ada', 'Unknown'], personIds: ['person-ada', ''],
        },
    } as PhotoEntry;
    const acceptedFaces = photo.faces;
    const acceptedClusters = dimension.serialize();
    let persisted = facesToDataAttrs(original, ids.map((clusterId, index) => ({clusterId, personName: index === 0 ? 'Ada' : undefined, personId: index === 0 ? 'person-ada' : undefined})));
    let publishedDimension = dimension;
    const writeCrops = vi.fn(async (_crops: Array<{name: string; blob: Blob}>) => {});
    const persist = vi.fn(async (attrs: Record<string, string>) => {persisted = attrs;});
    const publish = vi.fn((faces, dim) => {photo.faces = faces; publishedDimension = dim;});
    const run = (analyze: Parameters<typeof replaceFaceAnalysis>[0]['analyze']) => replaceFaceAnalysis({currentPhoto: () => photo, dimension, analyze, writeCrops, persist, publish});
    return {photo, acceptedFaces, acceptedClusters, dimension, persist, persisted: () => persisted, publishedDimension: () => publishedDimension, writeCrops, publish, run};
}

const output = (faces = [face(0), face(100, 1)]) => ({dataAttrs: facesToDataAttrs({faces}), cropBlobs: faces.map(face => ({name: face.cropPath, blob: new Blob(['new crop'])}))});

describe('face analysis replacement commit', () => {
    it('retains persisted and live results while inference is running, then on interruption', async () => {
        const test = fixture();
        const saved = test.persisted();
        let reject!: (cause: Error) => void;
        const inference = new Promise<ReturnType<typeof output>>((_, fail) => {reject = fail;});
        const running = test.run(() => inference);
        expect(test.photo.faces).toBe(test.acceptedFaces);
        expect(test.persisted()).toBe(saved);
        expect(test.persist).not.toHaveBeenCalled();
        reject(new Error('Worker interrupted'));
        await expect(running).rejects.toThrow('Worker interrupted');
        expect(test.photo.faces).toBe(test.acceptedFaces);
        expect(test.dimension.serialize()).toBe(test.acceptedClusters);
        expect(test.persisted()).toBe(saved);
        expect(test.publish).not.toHaveBeenCalled();
    });

    it.each(['crop', 'index'])('retains accepted state when the %s write fails', async failing => {
        const test = fixture();
        const saved = test.persisted();
        const crops = new Map(test.acceptedFaces!.crops.map(path => [path, 'accepted crop bytes']));
        const acceptedCrops = new Map(crops);
        test.writeCrops.mockImplementation(async next => {for (const crop of next) crops.set(`album/one/${crop.name}`, 'candidate crop bytes');});
        if (failing === 'crop') test.writeCrops.mockRejectedValueOnce(new Error('Disk full'));
        else test.persist.mockRejectedValueOnce(new Error('Permission denied'));
        await expect(test.run(async () => output())).rejects.toThrow(failing === 'crop' ? 'Disk full' : 'Permission denied');
        expect(test.photo.faces).toBe(test.acceptedFaces);
        expect(test.persisted()).toBe(saved);
        expect(test.dimension.serialize()).toBe(test.acceptedClusters);
        expect(test.publish).not.toHaveBeenCalled();
        for (const [path, bytes] of acceptedCrops) expect(crops.get(path)).toBe(bytes);
        expect(test.photo.faces?.crops).toEqual([...acceptedCrops.keys()]);
    });

    it('replaces successful results after persistence and retains identities despite detection reorder', async () => {
        const test = fixture();
        test.persist.mockImplementationOnce(async attrs => {
            expect(test.photo.faces).toBe(test.acceptedFaces);
            expect(attrs['face-names']).toBe('Unknown;Ada');
            expect(attrs['face-person-ids']).toBe(';person-ada');
        });
        await test.run(async () => output([face(100, 1), face(1)]));
        expect(test.writeCrops.mock.calls[0][0].every(crop => /^faces\/[0-9a-f-]{36}_\d+\.jpg$/.test(crop.name))).toBe(true);
        expect(test.photo.faces?.crops.every(path => !path.includes('old-'))).toBe(true);
        expect(test.photo.faces?.bboxes).toEqual([[100, 0, 140, 40], [1, 0, 41, 40]]);
        expect(test.photo.faces?.names).toEqual(['Unknown', 'Ada']);
        expect(test.photo.faces?.personIds).toEqual(['', 'person-ada']);
        expect(test.photo.faces?.clusterIds).toEqual(['photo:1', 'photo:0']);
        expect(test.dimension.serialize()).toBe(test.acceptedClusters);
        const members = test.publishedDimension().getAllClusters().flatMap(cluster => cluster.members);
        expect(members).toHaveLength(2);
        expect(new Set(members.map(member => `${member.photoHash}:${member.faceIndex}`)).size).toBe(2);
        expect(test.publish).toHaveBeenCalledOnce();
    });

    it('retains a cluster-owned name when its only photo is replaced', async () => {
        const test = fixture();
        test.photo.faces = {...test.photo.faces!, names: ['Unknown', 'Unknown']};
        await test.run(async () => output());
        expect(test.photo.faces?.names?.[0]).toBe('Ada');
        expect(test.publishedDimension().getCluster('photo:0')?.personName).toBe('Ada');
    });

    it('retains the named cluster if a new face is inserted ahead of it', async () => {
        const test = fixture();
        test.photo.faces = {...test.photo.faces!, count: 1, bboxes: [[0, 0, 40, 40]], scores: [0.9], embeddings: Float32Array.from(embedding()), crops: ['album/one/faces/old-0.jpg'], clusterIds: ['photo:0'], names: ['Ada'], personIds: ['person-ada']};
        await test.run(async () => output([face(100, 1), face(0)]));
        expect(test.photo.faces?.clusterIds?.[0]).not.toBe('photo:0');
        expect(test.photo.faces?.clusterIds?.[1]).toBe('photo:0');
        expect(test.photo.faces?.names).toEqual(['Unknown', 'Ada']);
        expect(test.photo.faces?.personIds).toEqual(['', 'person-ada']);
        expect(test.publishedDimension().getClusterCount()).toBe(2);
        expect(test.publishedDimension().getCluster('photo:0')?.members).toEqual([{photoHash: 'photo', faceIndex: 1}]);
    });

    it('keeps a name owned only by the cluster when the new detector misses it', async () => {
        const test = fixture();
        test.photo.faces = {...test.photo.faces!, names: ['Unknown', 'Unknown'], personIds: ['', '']};
        await expect(test.run(async () => output([]))).rejects.toThrow('Cannot safely retain the identity');
        expect(test.persist).not.toHaveBeenCalled();
        expect(test.dimension.getCluster('photo:0')?.personName).toBe('Ada');
    });

    it('inherits an existing explicit person group when a new photo joins its cluster', async () => {
        const test = fixture();
        const incoming = {...test.photo, hash: 'new-photo', sourcePath: 'album/new.jpg', faces: undefined};
        let nextFaces: PhotoEntry['faces'];
        await replaceFaceAnalysis({
            currentPhoto: () => incoming, dimension: test.dimension, acceptedPhotos: () => [test.photo], analyze: async () => output([face(0)]),
            writeCrops: test.writeCrops, persist: test.persist, publish: faces => {nextFaces = faces;},
        });
        expect(nextFaces?.clusterIds).toEqual(['photo:0']);
        expect(nextFaces?.names).toEqual(['Ada']);
        expect(nextFaces?.personIds).toEqual(['person-ada']);
    });

    it('feeds edits made during crop IO into the final staged replacement', async () => {
        const test = fixture();
        test.writeCrops.mockImplementationOnce(async () => {
            test.photo.faces = {...test.photo.faces!, names: ['Grace', 'Unknown'], personIds: ['person-grace', '']};
        });
        await test.run(async () => output());
        expect(test.persisted()['face-names']).toBe('Grace;Unknown');
        expect(test.photo.faces?.personIds?.[0]).toBe('person-grace');
    });

    it('serializes an annotation edit requested during persistence after replacement publication', async () => {
        const test = fixture();
        let edit: Promise<void> | undefined;
        test.persist.mockImplementationOnce(async () => {
            edit = queueFaceMetadataMutation(async () => {
                test.photo.faces = {...test.photo.faces!, names: ['Grace', 'Unknown']};
            });
            expect(test.photo.faces).toBe(test.acceptedFaces);
        });
        await replaceFaceAnalysis({
            currentPhoto: () => test.photo, dimension: test.dimension, analyze: async () => output(),
            writeCrops: test.writeCrops, persist: test.persist, publish: test.publish, commit: queueFaceMetadataMutation,
        });
        await edit;
        expect(test.photo.faces?.names?.[0]).toBe('Grace');
        expect(test.publish).toHaveBeenCalledOnce();
    });

    it('uses annotations changed while inference was running', async () => {
        const test = fixture();
        await test.run(async () => {
            test.photo.faces = {...test.photo.faces!, names: ['Grace', 'Unknown'], personIds: ['person-grace', '']};
            return output();
        });
        expect(test.persisted()['face-names']).toBe('Grace;Unknown');
        expect(test.photo.faces?.personIds?.[0]).toBe('person-grace');
    });

    it.each([
        {label: 'empty', faces: []},
        {label: 'unmatched', faces: [face(200)]},
        {label: 'ambiguous', faces: [face(0), face(2)]},
    ])('refuses a replacement that cannot uniquely preserve an annotated face ($label)', async ({faces}) => {
        const test = fixture();
        await expect(test.run(async () => output(faces))).rejects.toThrow('Cannot safely retain the identity');
        expect(test.photo.faces).toBe(test.acceptedFaces);
        expect(test.persist).not.toHaveBeenCalled();
        expect(test.dimension.serialize()).toBe(test.acceptedClusters);
    });

    it('accepts a genuine empty result when it discards no user annotations', async () => {
        const test = fixture();
        test.photo.faces = {...test.photo.faces!, names: ['Unknown', 'Unknown'], personIds: ['', '']};
        test.dimension.nameCluster('photo:0', '');
        await test.run(async () => output([]));
        expect(test.persisted()).toEqual({'face-count': '0'});
        expect(test.photo.faces?.count).toBe(0);
        expect(test.publishedDimension().getClusterCount()).toBe(0);
    });

    it.each([{}, {'face-count': 'NaN'}, {'face-count': '0broken'}, {'face-count': '1', 'face-bboxes': '0,0,40,40', 'face-scores': '.9'}])('rejects invalid worker data rather than accepting it as an empty result (%j)', async dataAttrs => {
        const test = fixture();
        await expect(test.run(async () => ({dataAttrs: dataAttrs as Record<string, string>, cropBlobs: []}))).rejects.toThrow();
        expect(test.photo.faces).toBe(test.acceptedFaces);
        expect(test.persist).not.toHaveBeenCalled();
    });
});

describe('semantic analysis replacement commit', () => {
    const old: SemanticInfo = {modelId: 'model', embedding: new Float32Array([1, 0])};
    it.each(['inference', 'persistence'])('retains saved and live embedding on %s failure', async failing => {
        let live = old;
        let saved = old;
        const publish = vi.fn(value => {live = value;});
        await expect(replaceSemanticAnalysis({
            analyze: async () => {if (failing === 'inference') throw new Error('Worker interrupted'); return {modelId: 'model', embedding: new Float32Array([0, 1])};},
            persist: async value => {if (failing === 'persistence') throw new Error('Disk full'); saved = value;}, publish,
        })).rejects.toThrow(failing === 'inference' ? 'Worker interrupted' : 'Disk full');
        expect(live).toBe(old);
        expect(saved).toBe(old);
        expect(publish).not.toHaveBeenCalled();
    });
    it('publishes the new embedding only once its save finishes', async () => {
        let live = old;
        const next = {modelId: 'model', embedding: new Float32Array([0, 1])};
        const persist = vi.fn(async value => {expect(live).toBe(old); expect(value).toBe(next);});
        await replaceSemanticAnalysis({analyze: async () => next, persist, publish: value => {live = value;}});
        expect(live).toBe(next);
        expect(persist).toHaveBeenCalledOnce();
    });
    it('rejects malformed output instead of publishing an unusable embedding', async () => {
        const publish = vi.fn();
        const persist = vi.fn();
        await expect(replaceSemanticAnalysis({analyze: async () => ({modelId: 'model', embedding: new Float32Array([NaN])}), persist, publish})).rejects.toThrow('invalid embedding');
        expect(persist).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });
});

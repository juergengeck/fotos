import {beforeEach, describe, expect, it, vi} from 'vitest';
import {FACE_DETECTION_MODEL_ID, FACE_DETECTIONS_MIME, type FotosEntry, type FotosMediaVariant} from '@refinio/fotos.core';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import {getFotosFaceNames, readFotosMobileFaceDetections} from './FotosMobileFaces';

const mocks = vi.hoisted(() => ({readVariant: vi.fn(), readBlob: vi.fn(), entryId: vi.fn()}));
vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({getObjectWithType: mocks.readVariant}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({readBlobAsArrayBuffer: mocks.readBlob}));
vi.mock('@refinio/one.core/lib/util/object.js', () => ({calculateIdHashOfObj: mocks.entryId}));

const entry: FotosEntry = {
    $type$: 'FotosEntry', contentHash: 'a'.repeat(64), streamId: 'test', mime: 'image/jpeg', size: 10, faceCount: 2,
    variants: new Set(['b'.repeat(64) as SHA256Hash<FotosMediaVariant>]),
};

describe('mobile face detection projection', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.entryId.mockResolvedValue('entry-id');
        mocks.readVariant.mockResolvedValue({
            role: 'analysis-output', family: 'entry-id', label: FACE_DETECTION_MODEL_ID,
            mime: FACE_DETECTIONS_MIME, blob: 'detections-blob',
        });
        mocks.readBlob.mockResolvedValue(new TextEncoder().encode(JSON.stringify({
            modelId: FACE_DETECTION_MODEL_ID,
            faces: [{bbox: [1, 2, 3, 4], score: 0.8, name: 'Ada'},
                {bbox: [9, 8, 7, 6], score: 0.7, name: 'Unknown'}],
        })).buffer);
    });

    it('reads desktop labels from an exact photo variant', async () => {
        const faces = await readFotosMobileFaceDetections(entry);
        expect(faces?.faces).toHaveLength(2);
        expect(getFotosFaceNames(faces)).toEqual(['Ada']);
        expect(mocks.readBlob).toHaveBeenCalledExactlyOnceWith('detections-blob');
    });

    it('requires matching family and count before displaying labels', async () => {
        await expect(readFotosMobileFaceDetections({...entry, faceCount: 1})).rejects.toThrow('photo face count');
        mocks.readVariant.mockResolvedValueOnce({
            role: 'analysis-output', family: 'another-entry', label: FACE_DETECTION_MODEL_ID,
            mime: FACE_DETECTIONS_MIME, blob: 'unrelated',
        });
        expect(await readFotosMobileFaceDetections(entry)).toBeUndefined();
        expect(mocks.readBlob).toHaveBeenCalledTimes(1);
    });
});

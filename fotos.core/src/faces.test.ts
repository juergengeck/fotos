import { beforeEach, describe, expect, it } from 'vitest';
import {
    disposeFaceModels,
    initFaceDetectionModel,
    initFaceModels,
    initFaceRecognitionModel,
    setPlatform,
} from './faces.js';

function createMockSession() {
    return {
        inputNames: ['input.1'],
        outputNames: ['output'],
        async run() {
            return {};
        },
        async release() {
            return;
        },
    };
}

describe('face model lifecycle', () => {
    beforeEach(async () => {
        await disposeFaceModels();
    });

    it('initializes the detection model without loading recognition', async () => {
        const createSessionCalls: string[] = [];
        setPlatform({
            images: {
                async decodeAndResize() {
                    throw new Error('not used');
                },
                async cropAndResize() {
                    throw new Error('not used');
                },
                async saveFaceCrop() {
                    throw new Error('not used');
                },
                async mkdirp() {
                    return;
                },
            },
            onnx: {
                async createSession(modelPath: string) {
                    createSessionCalls.push(modelPath);
                    return createMockSession();
                },
                createTensor(_type, data, dims) {
                    return { data, dims };
                },
            },
        });

        await initFaceDetectionModel('/models', (a, b) => `${a}/${b}`);

        expect(createSessionCalls).toEqual(['/models/det_10g.onnx']);
    });

    it('loads recognition separately after detection', async () => {
        const createSessionCalls: string[] = [];
        setPlatform({
            images: {
                async decodeAndResize() {
                    throw new Error('not used');
                },
                async cropAndResize() {
                    throw new Error('not used');
                },
                async saveFaceCrop() {
                    throw new Error('not used');
                },
                async mkdirp() {
                    return;
                },
            },
            onnx: {
                async createSession(modelPath: string) {
                    createSessionCalls.push(modelPath);
                    return createMockSession();
                },
                createTensor(_type, data, dims) {
                    return { data, dims };
                },
            },
        });

        await initFaceDetectionModel('/models', (a, b) => `${a}/${b}`);
        await initFaceRecognitionModel('/models', (a, b) => `${a}/${b}`);
        await initFaceRecognitionModel('/models', (a, b) => `${a}/${b}`);

        expect(createSessionCalls).toEqual([
            '/models/det_10g.onnx',
            '/models/w600k_r50.onnx',
        ]);
    });

    it('keeps full init backward-compatible', async () => {
        const createSessionCalls: string[] = [];
        setPlatform({
            images: {
                async decodeAndResize() {
                    throw new Error('not used');
                },
                async cropAndResize() {
                    throw new Error('not used');
                },
                async saveFaceCrop() {
                    throw new Error('not used');
                },
                async mkdirp() {
                    return;
                },
            },
            onnx: {
                async createSession(modelPath: string) {
                    createSessionCalls.push(modelPath);
                    return createMockSession();
                },
                createTensor(_type, data, dims) {
                    return { data, dims };
                },
            },
        });

        await initFaceModels('/models', (a, b) => `${a}/${b}`);

        expect(createSessionCalls).toEqual([
            '/models/det_10g.onnx',
            '/models/w600k_r50.onnx',
        ]);
    });
});

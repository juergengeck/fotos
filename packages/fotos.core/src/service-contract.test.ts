import { describe, expect, it } from 'vitest';
import {
    buildFotosBinaryUrl,
    decodeFotosServiceSemanticData,
    invokeFotosService,
    normalizeFotosServiceManagedMode,
    parseFotosServiceChannel,
    toFotosServiceChannel,
} from './service-contract.js';

describe('fotos service contract', () => {
    it('builds and parses fotos channels', () => {
        expect(toFotosServiceChannel('browse')).toBe('fotos:browse');
        expect(parseFotosServiceChannel('fotos:status')).toBe('status');
        expect(parseFotosServiceChannel('not-fotos:browse')).toBeNull();
    });

    it('normalizes legacy managed values for gallery consumers', () => {
        expect(normalizeFotosServiceManagedMode('reference')).toBe('reference');
        expect(normalizeFotosServiceManagedMode('metadata')).toBe('metadata');
        expect(normalizeFotosServiceManagedMode('ingest')).toBe('ingest');
        expect(normalizeFotosServiceManagedMode('ingested')).toBe('ingest');
        expect(normalizeFotosServiceManagedMode(undefined)).toBe('metadata');
    });

    it('builds binary resource URLs consistently', () => {
        expect(buildFotosBinaryUrl('https://fotos.one/', 'thumb', 'one/thumbs/a b.jpg'))
            .toBe('https://fotos.one/fotos/thumb/one%2Fthumbs%2Fa%20b.jpg');
        expect(buildFotosBinaryUrl('', 'file', 'albums/day 1/photo.jpg'))
            .toBe('/fotos/file/albums%2Fday%201%2Fphoto.jpg');
    });

    it('decodes semantic embedding payloads', () => {
        const floats = new Float32Array([0.5, -1.25, 3.75]);
        const embedding = btoa(String.fromCharCode(...new Uint8Array(floats.buffer)));
        const decoded = decodeFotosServiceSemanticData({
            modelId: 'gemma4:e4b',
            embedding,
        });

        expect(decoded?.modelId).toBe('gemma4:e4b');
        expect(Array.from(decoded?.embedding ?? [])).toEqual(Array.from(floats));
    });

    it('invokes a typed fotos transport', async () => {
        const calls: Array<{ channel: string; params: Record<string, unknown> }> = [];
        const result = await invokeFotosService(async (channel, params) => {
            calls.push({ channel, params });
            return {
                success: true,
                data: {
                    entries: [],
                    children: [],
                    total: 0,
                    limit: 10,
                    offset: 0,
                },
            };
        }, 'browse', { limit: 10 });

        expect(calls).toEqual([{ channel: 'fotos:browse', params: { limit: 10 } }]);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.limit).toBe(10);
        }
    });
});

import { describe, expect, it } from 'vitest';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { FotosDeviceBook } from './recipes/FotosDeviceBookRecipes.js';
import {
    appendFotosDeviceBookContent,
    buildFotosDeviceBookTitle,
    createFotosDeviceBook,
    getFotosDeviceBookIdHash,
    makeFotosDeviceBookId,
    type FotosDeviceBookPersistenceDeps,
} from './fotos-device-book.js';

describe('fotos-device-book', () => {
    it('builds deterministic ids and titles from the device id', () => {
        expect(makeFotosDeviceBookId('spark')).toBe('fotos-device-book:spark');
        expect(buildFotosDeviceBookTitle('schweiz')).toBe('Fotos Device Book (schweiz)');
    });

    it('creates a device book with explicit Fotos object references', () => {
        const book = createFotosDeviceBook({
            deviceId: 'spark',
            role: 'compute',
            entries: ['entry-hash-1' as any],
            sourceIdHashes: ['source-id-hash-1' as any],
            entryIdHashes: ['source-entry-id-hash-1' as any],
            variants: ['variant-hash-1' as any],
            locators: ['locator-hash-1' as any],
            authenticityAttestations: ['auth-hash-1' as any],
            createdAt: 10,
            updatedAt: 20,
        });

        expect(book).toMatchObject({
            $type$: 'FotosDeviceBook',
            id: 'fotos-device-book:spark',
            deviceId: 'spark',
            title: 'Fotos Device Book (spark)',
            role: 'compute',
            createdAt: 10,
            updatedAt: 20,
        });
        expect([...book.entries]).toEqual(['entry-hash-1']);
        expect([...book.sourceIdHashes ?? []]).toEqual(['source-id-hash-1']);
        expect([...book.entryIdHashes ?? []]).toEqual(['source-entry-id-hash-1']);
        expect([...book.variants ?? []]).toEqual(['variant-hash-1']);
        expect([...book.locators ?? []]).toEqual(['locator-hash-1']);
        expect([...book.authenticityAttestations ?? []]).toEqual(['auth-hash-1']);
    });

    it('appends new refs without rewriting unchanged device books', async () => {
        const byId = new Map<string, FotosDeviceBook>();
        const byHash = new Map<string, FotosDeviceBook>();
        const deps: FotosDeviceBookPersistenceDeps = {
            async calculateIdHashOfObj<T>(obj: T): Promise<SHA256IdHash<T>> {
                return `id:${String((obj as { id?: unknown }).id ?? '')}` as SHA256IdHash<T>;
            },
            async getObjectByIdHash<T>(idHash: SHA256IdHash<T>) {
                const obj = byHash.get(String(idHash));
                if (!obj) {
                    throw new Error('not found');
                }
                return {
                    obj: obj as unknown as T,
                    hash: `hash:${obj.id}:${obj.updatedAt}` as any,
                };
            },
            async storeVersionedObject<T>(obj: T) {
                const typed = obj as unknown as FotosDeviceBook;
                const idHash = `id:${typed.id}`;
                byId.set(typed.id, typed);
                byHash.set(idHash, typed);
                return {
                    obj,
                    idHash: idHash as SHA256IdHash<T>,
                    hash: `hash:${typed.id}:${typed.updatedAt}` as any,
                };
            },
        };

        const first = await appendFotosDeviceBookContent(deps, {
            deviceId: 'spark',
            role: 'compute',
            entries: ['entry-hash-1' as any],
            sourceIdHashes: ['source-id-hash-1' as any],
            variants: ['variant-hash-1' as any],
            updatedAt: 100,
        });
        expect(first.created).toBe(true);
        expect(first.updated).toBe(false);

        const second = await appendFotosDeviceBookContent(deps, {
            deviceId: 'spark',
            entries: ['entry-hash-1' as any, 'entry-hash-2' as any],
            entryIdHashes: ['source-entry-id-hash-2' as any],
            locators: ['locator-hash-1' as any],
            updatedAt: 200,
        });
        expect(second.created).toBe(false);
        expect(second.updated).toBe(true);
        expect([...second.stored.obj.entries]).toEqual(['entry-hash-1', 'entry-hash-2']);
        expect([...second.stored.obj.sourceIdHashes ?? []]).toEqual(['source-id-hash-1']);
        expect([...second.stored.obj.entryIdHashes ?? []]).toEqual(['source-entry-id-hash-2']);
        expect([...second.stored.obj.locators ?? []]).toEqual(['locator-hash-1']);

        const third = await appendFotosDeviceBookContent(deps, {
            deviceId: 'spark',
            entries: ['entry-hash-2' as any],
            updatedAt: 300,
        });
        expect(third.updated).toBe(false);
        expect(third.stored.hash).toBe('hash:fotos-device-book:spark:200');
        expect(await getFotosDeviceBookIdHash(deps, 'spark')).toBe('id:fotos-device-book:spark');
    });
});

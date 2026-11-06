import {describe, expect, it} from 'vitest';
import type {FotosEntry} from './recipes/FotosRecipes.js';
import {getSharedFotosCollectionPath, SharedFotosFileSystem} from './shared-fotos-file-system.js';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return {promise, resolve};
}

const issuer = 'issuer';
const collection = getSharedFotosCollectionPath('collection', issuer);
const first: FotosEntry = {
    $type$: 'FotosEntry',
    contentHash: 'first-content',
    streamId: 'first-stream',
    mime: 'image/png',
    size: 3,
    sourcePath: 'first.png',
};
const second: FotosEntry = {
    $type$: 'FotosEntry',
    contentHash: 'second-content',
    streamId: 'second-stream',
    mime: 'image/jpeg',
    size: 4,
    sourcePath: 'second.jpg',
};

function active(entries: FotosEntry[] = [first, second]) {
    return [{
        certificateIdHash: 'certificate-id',
        certificateHash: 'certificate-hash',
        issuer,
        scope: {kind: 'collection', id: 'collection'},
        status: 'active',
        verified: true,
        entries,
    }] as any;
}

function dependencies(project: any, readOriginal?: any) {
    return {
        project,
        readOriginal: readOriginal ?? (async (entry: FotosEntry) => ({
            content: new Uint8Array(entry.size).buffer,
        })),
        hashEntry: async (entry: FotosEntry) => `hash:${entry.contentHash}`,
        hashTree: async (value: string) => `tree:${value}`,
    };
}

function code(error: unknown): number | undefined {
    return (error as {code?: number})?.code;
}

describe('SharedFotosFileSystem projection lifecycle', () => {
    it('shares one projection and verification across concurrent and sequential filesystem calls', async () => {
        const pending = deferred<any>();
        let projects = 0;
        let verifications = 0;
        const fs = new SharedFotosFileSystem('subject', async () => {
            verifications += 1;
            return true;
        }, dependencies(async (_subject: string, verify: (signature: unknown) => Promise<boolean>) => {
            projects += 1;
            await verify({});
            return pending.promise;
        }));

        const root = fs.readDir('/');
        const rootStat = fs.stat('/');
        expect(projects).toBe(1);
        pending.resolve(active());
        await Promise.all([root, rootStat]);
        await fs.readDir(collection);
        await fs.stat(`${collection}/first.png`);
        await fs.readFile(`${collection}/first.png`);
        await fs.stat(`${collection}/second.jpg`);
        await fs.readFile(`${collection}/second.jpg`);

        expect({projects, verifications}).toEqual({projects: 1, verifications: 1});
        expect(fs.getDiagnostics()).toMatchObject({
            buildCount: 1,
            cacheHitCount: 6,
            invalidationCount: 0,
        });
    });

    it('rebuilds exactly once after explicit invalidation', async () => {
        let projects = 0;
        const fs = new SharedFotosFileSystem('subject', async () => true, dependencies(async () => {
            projects += 1;
            return active([]);
        }));

        await fs.readDir('/');
        await fs.stat('/');
        fs.invalidate();
        await Promise.all([fs.readDir('/'), fs.stat('/')]);

        expect(projects).toBe(2);
        expect(fs.getDiagnostics()).toMatchObject({
            buildCount: 2,
            invalidationCount: 1,
        });
    });

    it('reuses immutable signature verification until the trust projection changes', async () => {
        let projects = 0;
        let verifications = 0;
        const fs = new SharedFotosFileSystem('subject', async () => {
            verifications += 1;
            return true;
        }, dependencies(async (_subject: string, verify: (
            signature: unknown,
            signatureHash?: string,
        ) => Promise<boolean>) => {
            projects += 1;
            await verify({$type$: 'Signature'}, 'immutable-signature-hash');
            return active([]);
        }));

        await fs.readDir('/');
        fs.invalidate();
        await fs.readDir('/');
        expect({projects, verifications}).toEqual({projects: 2, verifications: 1});

        fs.invalidate({trustChanged: true});
        await fs.readDir('/');
        expect({projects, verifications}).toEqual({projects: 3, verifications: 2});
        expect(fs.getDiagnostics()).toMatchObject({
            buildCount: 3,
            invalidationCount: 2,
            signatureVerificationCount: 2,
            signatureVerificationCacheHitCount: 1,
        });
    });

    it('discards an active tree invalidated by revocation while it is building', async () => {
        const firstProjection = deferred<any>();
        let projects = 0;
        let originals = 0;
        let revoked = false;
        const fs = new SharedFotosFileSystem('subject', async () => true, dependencies(async () => {
            projects += 1;
            return projects === 1 ? firstProjection.promise : revoked ? [] : active([first]);
        }, async () => {
            originals += 1;
            return {content: new Uint8Array(3).buffer};
        }));

        const reading = fs.readFile(`${collection}/first.png`);
        revoked = true;
        fs.invalidate();
        firstProjection.resolve(active([first]));

        await expect(reading).rejects.toSatisfy((error: unknown) => code(error) === -2);
        expect({projects, originals}).toEqual({projects: 2, originals: 0});
    });

    it('does not publish a verification completed after its trust generation was revoked', async () => {
        const firstVerification = deferred<boolean>();
        let projects = 0;
        let verifications = 0;
        let trusted = true;
        const fs = new SharedFotosFileSystem('subject', async () => {
            verifications += 1;
            return verifications === 1 ? firstVerification.promise : trusted;
        }, dependencies(async (_subject: string, verify: (
            signature: unknown,
            signatureHash?: string,
        ) => Promise<boolean>) => {
            projects += 1;
            return await verify({$type$: 'Signature'}, 'immutable-signature-hash')
                ? active([first])
                : [];
        }));

        const reading = fs.readFile(`${collection}/first.png`);
        trusted = false;
        fs.invalidate({trustChanged: true});
        firstVerification.resolve(true);

        await expect(reading).rejects.toSatisfy((error: unknown) => code(error) === -2);
        expect({projects, verifications}).toEqual({projects: 2, verifications: 2});
        expect(fs.getDiagnostics()).toMatchObject({
            signatureVerificationCount: 2,
            signatureVerificationCacheHitCount: 0,
        });
    });

    it('does not return bytes when revocation arrives during original hydration', async () => {
        const original = deferred<{content: ArrayBuffer}>();
        const originalStarted = deferred<void>();
        let projects = 0;
        let revoked = false;
        const fs = new SharedFotosFileSystem('subject', async () => true, dependencies(async () => {
            projects += 1;
            return revoked ? [] : active([first]);
        }, async () => {
            originalStarted.resolve();
            return original.promise;
        }));

        const reading = fs.readFile(`${collection}/first.png`);
        await originalStarted.promise;
        revoked = true;
        fs.invalidate();
        original.resolve({content: new Uint8Array([1, 2, 3]).buffer});

        await expect(reading).rejects.toSatisfy((error: unknown) => code(error) === -2);
        expect(projects).toBe(2);
    });

    it('rejects an in-flight and every later read after disposal', async () => {
        const projection = deferred<any>();
        const fs = new SharedFotosFileSystem('subject', async () => true, dependencies(async () =>
            projection.promise));

        const reading = fs.readDir('/');
        fs.dispose();
        projection.resolve(active([]));

        await expect(reading).rejects.toSatisfy((error: unknown) => code(error) === -5);
        await expect(fs.readDir('/')).rejects.toSatisfy((error: unknown) => code(error) === -5);
        expect(fs.getObservedContainers()).toEqual(['root']);
    });
});

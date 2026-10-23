import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash, storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {readBlobAsArrayBuffer, storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {hashImageBytes} from './ingest/hash.js';
export {FotosRecipes} from './recipes/FotosRecipes.js';
import type {FotosEntry, FotosManifest} from './recipes/FotosRecipes.js';
import type {FotosMediaVariant} from './recipes/FotosMediaRecipes.js';
import {createFotosMediaVariant} from './media-model.js';

type ProjectedEntry = {path: string; hash: SHA256Hash<FotosEntry>; entry: FotosEntry};

/** Filesystem projection over one explicit Fotos manifest and its media DAG. */
export class FotosFileSystem {
    private writes: Promise<void> = Promise.resolve();

    constructor(
        readonly manifestId: string,
        private readonly writable = false,
        private readonly resolveOriginal?: (entry: FotosEntry) => Promise<ArrayBuffer>,
    ) {
        if (!manifestId) throw new Error('Fotos manifest id is required');
    }

    /** Calculate the stable root used for both browsing and IdAccess sharing. */
    async getRootId(): Promise<SHA256IdHash<FotosManifest>> {
        return calculateIdHashOfObj({$type$: 'FotosManifest', id: this.manifestId});
    }

    /** Create a new local manifest only when the configured root is absent. */
    async init(): Promise<void> {
        try {
            await this.readManifest();
        } catch (error) {
            if (!(error instanceof Error) || error.name !== 'FileNotFoundError' || !this.writable) throw error;
            await storeVersionedObject({$type$: 'FotosManifest', id: this.manifestId, entries: new Set<SHA256Hash<FotosEntry>>()});
        }
    }

    /** Store an original through the same import path used by File Provider RPC. */
    async importFile(name: string, content: ArrayBuffer): Promise<void> {
        const blob = await storeArrayBufferAsBlob(content);
        await this.createFile('/', blob.hash, name, 0o100444);
    }

    /** Read the configured root. A missing root is an initialization error. */
    private async readManifest() {
        return getObjectByIdHash(await this.getRootId());
    }

    /** Resolve only entry references reachable from the configured manifest. */
    private async entries(): Promise<ProjectedEntry[]> {
        const {obj} = await this.readManifest();
        const paths = new Set<string>();
        const entries: ProjectedEntry[] = [];
        for (const hash of obj.entries) {
            const entry = await getObject(hash);
            if (!entry.sourcePath) throw new Error(`Fotos entry ${entry.contentHash} has no sourcePath`);
            const path = this.path('/' + entry.sourcePath);
            if (paths.has(path)) throw new Error(`Conflicting Fotos paths: ${path}`);
            paths.add(path);
            entries.push({path, hash, entry});
        }
        return entries.sort((a, b) => a.path.localeCompare(b.path));
    }

    /** Require a canonical absolute virtual path, never a host filesystem path. */
    private path(value: string): string {
        if (value === '/') return value;
        if (!value.startsWith('/') || value.includes('\\') || value.includes('\0')
            || value.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
            throw new Error(`Invalid Fotos path: ${value}`);
        }
        return value;
    }

    /** Enumerate virtual folders derived directly from Fotos source paths. */
    async readDir(path: string): Promise<{children: string[]}> {
        path = this.path(path);
        const entries = await this.entries();
        const prefix = path === '/' ? '/' : path + '/';
        const children = new Set(entries.filter(item => item.path.startsWith(prefix))
            .map(item => item.path.slice(prefix.length).split('/')[0]));
        if (path !== '/' && children.size === 0) throw new Error(`Fotos directory does not exist: ${path}`);
        return {children: [...children].sort()};
    }

    /** Return stable content and metadata versions with POSIX permissions. */
    async stat(path: string) {
        path = this.path(path);
        const entries = await this.entries();
        const item = entries.find(item => item.path === path);
        if (item) return {
            mode: 0o100444, size: item.entry.size,
            contentHash: item.entry.contentHash, metadataHash: item.hash, mimeType: item.entry.mime,
        };
        if (path !== '/' && !entries.some(item => item.path.startsWith(path + '/'))) {
            throw new Error(`Fotos path does not exist: ${path}`);
        }
        const root = await this.readManifest();
        return {mode: path === '/' && this.writable ? 0o040755 : 0o040555, size: 0,
            contentHash: root.hash, metadataHash: root.hash};
    }

    /** Materialize the original through its explicit variant BLOB or owning adapter. */
    async readFile(path: string): Promise<{content: ArrayBuffer}> {
        path = this.path(path);
        const item = (await this.entries()).find(item => item.path === path);
        if (!item) throw new Error(`Fotos file does not exist: ${path}`);
        return readFotosOriginal(item.entry, this.resolveOriginal);
    }

    /** Read a bounded part of the original file. */
    async readFileInChunks(path: string, length: number, position: number) {
        if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
            throw new Error('Invalid Fotos read range');
        }
        return {content: (await this.readFile(path)).content.slice(position, position + length)};
    }

    /** Chunk requests are supported by the projection. */
    supportsChunkedReading(): boolean { return true; }

    /** Import an original BLOB into Fotos, then publish the complete entry through the root. */
    async createFile(directory: string, blob: SHA256Hash<BLOB>, name: string, _mode: number): Promise<void> {
        if (!this.writable || directory !== '/') throw new Error('Import files into the writable Fotos root');
        if (name.includes('/')) throw new Error('Fotos filename must be a single component');
        const path = this.path('/' + name);
        const operation = this.writes.then(async () => {
            const entries = await this.entries();
            const mime = this.mime(name);
            const content = await readBlobAsArrayBuffer(blob);
            const contentHash = await hashImageBytes(new Uint8Array(content));
            const existing = entries.find(item => item.path === path);
            if (existing) {
                if (existing.entry.contentHash === contentHash) return;
                throw new Error(`Fotos file already exists: ${path}`);
            }
            if (entries.some(item => item.entry.contentHash === contentHash)) {
                throw new Error('This original already belongs to the Fotos manifest');
            }
            const entry: FotosEntry = {$type$: 'FotosEntry', contentHash, streamId: contentHash,
                mime, size: content.byteLength, sourcePath: name};
            const family = await calculateIdHashOfObj(entry);
            const variant = await storeVersionedObject(createFotosMediaVariant({
                contentHash, family, role: 'original', mime, byteSize: content.byteLength, blob,
            }));
            entry.variants = new Set([variant.hash]);
            const stored = await storeVersionedObject(entry);
            const {obj} = await this.readManifest();
            await storeVersionedObject({...obj, entries: new Set([...obj.entries, stored.hash])});
        });
        // Serialization releases the queue after failure; the caller still receives the error.
        this.writes = operation.then(() => {}, () => {});
        return operation;
    }

    /** Supported media extensions are explicit at the import boundary. */
    private mime(name: string): string {
        const types: Record<string, string> = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
            heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', gif: 'image/gif',
            tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime'};
        const mime = types[name.split('.').pop()!.toLowerCase()];
        if (!mime) throw new Error(`Unsupported Fotos media extension: ${name}`);
        return mime;
    }

    /** Catalog folders are projections of source paths; they cannot be created separately. */
    async createDir(_path: string, _mode: number): Promise<void> { throw new Error('Fotos folders are derived from media paths'); }
    /** Fotos does not expose symlinks. */
    async readlink(_path: string): Promise<{content: ArrayBuffer}> { throw new Error('Fotos does not expose symlinks'); }
    /** Fotos does not expose symlinks. */
    async symlink(_src: string, _dest: string): Promise<void> { throw new Error('Fotos does not expose symlinks'); }
    /** Deletion is owned by the Fotos catalog. */
    async unlink(_path: string): Promise<number> { throw new Error('Fotos files are read-only'); }
    /** Deletion is owned by the Fotos catalog. */
    async rmdir(_path: string): Promise<number> { throw new Error('Fotos folders are read-only'); }
    /** Renaming is owned by the Fotos catalog. */
    async rename(_src: string, _dest: string): Promise<number> { throw new Error('Fotos files are read-only'); }
    /** Permissions are defined by the projection. */
    async chmod(_path: string, _mode: number): Promise<number> { throw new Error('Fotos permissions are fixed'); }
}

/** Resolve and verify an original from the exact entry selected by a manifest. */
export async function readFotosOriginal(entry: FotosEntry, resolveOriginal?: (entry: FotosEntry) => Promise<ArrayBuffer>): Promise<{content: ArrayBuffer}> {
    const variants: FotosMediaVariant[] = [];
    for (const hash of entry.variants ?? []) variants.push(await getObject(hash));
    const original = variants.find(variant => variant.role === 'original'
        && variant.contentHash === entry.contentHash);
    let content: ArrayBuffer;
    if (original?.blob) content = await readBlobAsArrayBuffer(original.blob);
    else if (resolveOriginal) content = await resolveOriginal(entry);
    else throw new Error(`Fotos original is unavailable locally: ${entry.contentHash}`);
    if (content.byteLength !== entry.size) throw new Error(`Fotos original size mismatch: ${entry.sourcePath}`);
    if (await hashImageBytes(new Uint8Array(content)) !== entry.contentHash) {
        throw new Error(`Fotos original content hash mismatch: ${entry.sourcePath}`);
    }
    return {content};
}

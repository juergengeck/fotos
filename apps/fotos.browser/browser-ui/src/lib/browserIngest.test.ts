// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {File as NodeFile, Blob as NodeBlob} from 'node:buffer';
import {webcrypto as crypto} from 'node:crypto';

const File = NodeFile as unknown as typeof globalThis.File;
const Blob = NodeBlob as unknown as typeof globalThis.Blob;
import { copyFilesToDirectory, hashImageFile, ingestDirectory, isImportableMediaFile } from './browserIngest';

vi.mock('./mediaThumbnail.js', () => ({
    generateMediaThumbnail: vi.fn(async () => new Blob(['poster'], {type: 'image/jpeg'})),
}));

class MemoryFileHandle {
    readonly kind = 'file';
    content: Blob | string | null = null;

    constructor(readonly name: string) {}

    async getFile(): Promise<File> {
        return this.content instanceof File ? this.content : new File([this.content ?? ''], this.name);
    }

    async createWritable() {
        return {
            write: async (data: Blob | string) => {
                this.content = data;
            },
            close: async () => {},
        };
    }
}

class MemoryDirectoryHandle {
    readonly kind = 'directory';
    readonly directories = new Map<string, MemoryDirectoryHandle>();
    readonly files = new Map<string, MemoryFileHandle>();

    constructor(readonly name: string) {}

    async *entries() {
        yield* this.files.entries();
        yield* this.directories.entries();
    }

    async getDirectoryHandle(
        name: string,
        options: { create?: boolean } = {},
    ): Promise<MemoryDirectoryHandle> {
        const existing = this.directories.get(name);
        if (existing) {
            return existing;
        }

        if (!options.create) {
            throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
        }

        const next = new MemoryDirectoryHandle(name);
        this.directories.set(name, next);
        return next;
    }

    async getFileHandle(
        name: string,
        options: { create?: boolean } = {},
    ): Promise<MemoryFileHandle> {
        const existing = this.files.get(name);
        if (existing) {
            return existing;
        }

        if (!options.create) {
            throw new DOMException(`File not found: ${name}`, 'NotFoundError');
        }

        const next = new MemoryFileHandle(name);
        this.files.set(name, next);
        return next;
    }
}

function imageFile(name: string, webkitRelativePath: string): File {
    const file = new File(['image bytes'], name, { type: 'image/jpeg' });
    Object.defineProperty(file, 'webkitRelativePath', {
        configurable: true,
        value: webkitRelativePath,
    });
    return file;
}

describe('copyFilesToDirectory', () => {
    it('keeps GIF and video originals while rejecting unrelated files', async () => {
        const root = new MemoryDirectoryHandle('library');
        const gif = new File(['GIF89a original animation'], 'animation.GIF', {type: 'image/gif'});
        const video = new File(['original video'], 'clip.mp4', {type: 'video/mp4'});
        const copied = await copyFilesToDirectory(root as unknown as FileSystemDirectoryHandle, [
            gif, video, new File(['text'], 'notes.txt', {type: 'text/plain'}),
        ]);
        expect(copied).toBe(2);
        expect(root.files.get('animation.GIF')?.content).toBe(gif);
        expect(root.files.get('clip.mp4')?.content).toBe(video);
    });

    it('preserves selected directory structure from webkitRelativePath', async () => {
        const root = new MemoryDirectoryHandle('library');
        const copied = await copyFilesToDirectory(root as unknown as FileSystemDirectoryHandle, [
            imageFile('rose.jpg', 'Vacation/Day 1/rose.jpg'),
            imageFile('beach.jpg', 'Vacation/Day 2/beach.jpg'),
        ]);

        expect(copied).toBe(2);
        expect(root.files.size).toBe(0);
        expect(root.directories.get('Vacation')).toBeUndefined();

        const day1 = root.directories.get('Day 1');
        const day2 = root.directories.get('Day 2');
        expect(day1?.files.get('rose.jpg')?.content).toBeInstanceOf(File);
        expect(day2?.files.get('beach.jpg')?.content).toBeInstanceOf(File);
    });
});

describe('media import identity', () => {
    it('indexes a video-only directory without passing video bytes to image analysis', async () => {
        const root = new MemoryDirectoryHandle('library');
        const file = new File(['original movie'], 'clip.mp4', {type: 'video/mp4'});
        const handle = new MemoryFileHandle(file.name);
        handle.content = file;
        root.files.set(file.name, handle);
        const analyze = vi.fn();
        expect(await ingestDirectory(root as unknown as FileSystemDirectoryHandle, undefined, {analyze})).toBe(1);
        const html = root.directories.get('one')?.files.get('index.html')?.content;
        expect(html).toContain('video/mp4');
        expect(html).toContain(await hashImageFile(file));
        expect(html).toContain('thumbs/');
        expect(analyze).not.toHaveBeenCalled();
        expect(handle.content).toBe(file);
    });

    it('accepts GIF and supported videos with missing MIME types', () => {
        for (const name of ['animation.gif', 'clip.MP4', 'clip.webm', 'clip.mov']) {
            expect(isImportableMediaFile(new File(['bytes'], name))).toBe(true);
        }
        expect(isImportableMediaFile(new File(['bytes'], 'notes.txt'))).toBe(false);
    });

    it('hashes all GIF bytes including animation frames', async () => {
        const bytes = new TextEncoder().encode('GIF89a two frames and timing');
        const file = new File([bytes], 'animation.gif', {type: 'image/gif'});
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const expected = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        expect(await hashImageFile(file)).toBe(expected);
        expect(await hashImageFile(new File([bytes, 'another frame'], 'animation.gif'))).not.toBe(expected);
    });
});


describe('reingest analysis retention', () => {
    it('keeps accepted face identities and semantic data without invoking detection again', async () => {
        const root = new MemoryDirectoryHandle('library');
        const source = new File(['original movie'], 'clip.mp4', {type: 'video/mp4'});
        const original = new MemoryFileHandle(source.name);
        original.content = source;
        root.files.set(source.name, original);
        await ingestDirectory(root as unknown as FileSystemDirectoryHandle);
        const index = root.directories.get('one')!.files.get('index.html')!;
        // Use an image row on the second pass to exercise the inline face worker.
        original.content = new File(['image bytes'], 'family.jpg', {type: 'image/jpeg'});
        root.files.delete(source.name);
        root.files.set('family.jpg', original);
        const hash = await hashImageFile(await original.getFile());
        index.content = `<table><tr class="fs-entry" data-content-hash="${hash}" data-face-count="1" data-face-names="Ada" data-face-cluster-hashes="cluster" data-face-person-ids="person-ada" data-semantic-model-id="model" data-semantic-embedding="AAABAA=="></tr></table>`;
        const analyze = vi.fn(async () => ({dataAttrs: {'face-count': '0'}, cropBlobs: []}));
        await ingestDirectory(root as unknown as FileSystemDirectoryHandle, undefined, {analyze});
        expect(analyze).not.toHaveBeenCalled();
        const saved = String(index.content);
        expect(saved).toContain('data-face-names="Ada"');
        expect(saved).toContain('data-face-person-ids="person-ada"');
        expect(saved).toContain('data-semantic-model-id="model"');
        expect(saved).toContain('data-face-count="1"');
    });

    it('does not overwrite the index if reading preserved metadata fails', async () => {
        const root = new MemoryDirectoryHandle('library');
        const source = new MemoryFileHandle('clip.mp4');
        source.content = new File(['movie'], 'clip.mp4', {type: 'video/mp4'});
        root.files.set(source.name, source);
        const one = await root.getDirectoryHandle('one', {create: true});
        const index = await one.getFileHandle('index.html', {create: true});
        index.content = 'accepted metadata';
        vi.spyOn(index, 'getFile').mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
        await expect(ingestDirectory(root as unknown as FileSystemDirectoryHandle)).rejects.toThrow('Permission denied');
        expect(index.content).toBe('accepted metadata');
    });
});

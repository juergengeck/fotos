import { describe, expect, it, vi } from 'vitest';
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
            throw new Error(`Directory not found: ${name}`);
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
            throw new Error(`File not found: ${name}`);
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

// platform-node.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import {
    discoverFolders,
    listImages,
    readImageBytes,
    writeBytes,
    generateThumbnail,
    setThumbnailGenerator,
} from './platform-node.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-test-'));
}

const TEST_THUMBNAIL_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

afterEach(() => {
    setThumbnailGenerator(null);
});

describe('discoverFolders', () => {
    it('lists subdirectories containing images, skipping hidden and one', () => {
        const tmp = makeTmpDir();
        fs.mkdirSync(path.join(tmp, '2017'));
        fs.mkdirSync(path.join(tmp, '2018'));
        fs.mkdirSync(path.join(tmp, '.hidden'));
        fs.mkdirSync(path.join(tmp, 'one'));
        fs.mkdirSync(path.join(tmp, 'node_modules'));
        // Put images only in the year folders (not root, hidden, one, or node_modules)
        fs.writeFileSync(path.join(tmp, '2017', 'a.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, '2018', 'b.png'), 'fake');
        fs.writeFileSync(path.join(tmp, '.hidden', 'c.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, 'one', 'd.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, 'node_modules', 'e.jpg'), 'fake');

        const folders = discoverFolders(tmp);
        const names = folders.map(f => f.name).sort();
        expect(names).toEqual(['2017', '2018']);

        fs.rmSync(tmp, { recursive: true });
    });

    it('includes root if it contains images', () => {
        const tmp = makeTmpDir();
        fs.writeFileSync(path.join(tmp, 'photo.jpg'), 'fake');

        const folders = discoverFolders(tmp);
        expect(folders.some(f => f.relPath === '')).toBe(true);

        fs.rmSync(tmp, { recursive: true });
    });

    it('discovers nested folders recursively', () => {
        const tmp = makeTmpDir();
        fs.mkdirSync(path.join(tmp, 'a', 'b'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'a', 'x.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, 'a', 'b', 'y.png'), 'fake');

        const folders = discoverFolders(tmp);
        expect(folders).toHaveLength(2);
        expect(folders.some(f => f.relPath === 'a')).toBe(true);
        expect(folders.some(f => f.relPath === path.join('a', 'b'))).toBe(true);

        fs.rmSync(tmp, { recursive: true });
    });

    it('returns empty for directory with no images', () => {
        const tmp = makeTmpDir();
        fs.writeFileSync(path.join(tmp, 'readme.txt'), 'not an image');

        const folders = discoverFolders(tmp);
        expect(folders).toHaveLength(0);

        fs.rmSync(tmp, { recursive: true });
    });
});

describe('listImages', () => {
    it('lists image files in a directory', () => {
        const tmp = makeTmpDir();
        fs.writeFileSync(path.join(tmp, 'a.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, 'b.png'), 'fake');
        fs.writeFileSync(path.join(tmp, 'c.txt'), 'not image');

        const images = listImages(tmp);
        expect(images.map(i => i.name).sort()).toEqual(['a.jpg', 'b.png']);

        fs.rmSync(tmp, { recursive: true });
    });

    it('returns correct mime types', () => {
        const tmp = makeTmpDir();
        fs.writeFileSync(path.join(tmp, 'photo.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, 'image.webp'), 'fake');
        fs.writeFileSync(path.join(tmp, 'pic.heic'), 'fake');

        const images = listImages(tmp);
        const mimeMap = new Map(images.map(i => [i.name, i.mime]));
        expect(mimeMap.get('photo.jpg')).toBe('image/jpeg');
        expect(mimeMap.get('image.webp')).toBe('image/webp');
        expect(mimeMap.get('pic.heic')).toBe('image/heic');

        fs.rmSync(tmp, { recursive: true });
    });

    it('skips hidden files', () => {
        const tmp = makeTmpDir();
        fs.writeFileSync(path.join(tmp, '.hidden.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, 'visible.jpg'), 'fake');

        const images = listImages(tmp);
        expect(images).toHaveLength(1);
        expect(images[0].name).toBe('visible.jpg');

        fs.rmSync(tmp, { recursive: true });
    });

    it('includes size and mtime', () => {
        const tmp = makeTmpDir();
        const content = 'fake image data';
        fs.writeFileSync(path.join(tmp, 'photo.jpg'), content);

        const images = listImages(tmp);
        expect(images[0].size).toBe(content.length);
        expect(images[0].mtime).toBeGreaterThan(0);

        fs.rmSync(tmp, { recursive: true });
    });

    it('is non-recursive (does not list images in subdirectories)', () => {
        const tmp = makeTmpDir();
        fs.mkdirSync(path.join(tmp, 'sub'));
        fs.writeFileSync(path.join(tmp, 'root.jpg'), 'fake');
        fs.writeFileSync(path.join(tmp, 'sub', 'nested.jpg'), 'fake');

        const images = listImages(tmp);
        expect(images).toHaveLength(1);
        expect(images[0].name).toBe('root.jpg');

        fs.rmSync(tmp, { recursive: true });
    });
});

describe('readImageBytes', () => {
    it('reads file as Uint8Array', () => {
        const tmp = makeTmpDir();
        const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
        fs.writeFileSync(path.join(tmp, 'test.bin'), data);

        const bytes = readImageBytes(path.join(tmp, 'test.bin'));
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(6);
        expect(bytes[0]).toBe(0xff);
        expect(bytes[1]).toBe(0xd8);

        fs.rmSync(tmp, { recursive: true });
    });
});

describe('writeBytes', () => {
    it('writes data to file', () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'output.bin');
        const data = new Uint8Array([1, 2, 3, 4]);

        writeBytes(filePath, data);
        const read = fs.readFileSync(filePath);
        expect(Array.from(read)).toEqual([1, 2, 3, 4]);

        fs.rmSync(tmp, { recursive: true });
    });

    it('creates parent directories as needed', () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'deep', 'nested', 'dir', 'file.txt');

        writeBytes(filePath, 'hello');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');

        fs.rmSync(tmp, { recursive: true });
    });

    it('writes string data', () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'text.txt');

        writeBytes(filePath, 'hello world');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');

        fs.rmSync(tmp, { recursive: true });
    });
});

describe('generateThumbnail', () => {
    it('uses the configured thumbnail generator', async () => {
        const tmp = makeTmpDir();
        const inputPath = path.join(tmp, 'input.jpg');
        fs.writeFileSync(inputPath, 'fake');

        const calls: Array<{ filePath: string; maxSize: number; quality: number }> = [];
        setThumbnailGenerator(async (filePath, { maxSize, quality }) => {
            calls.push({ filePath, maxSize, quality });
            return TEST_THUMBNAIL_BYTES;
        });

        const thumbBytes = await generateThumbnail(inputPath, 50, 70);
        expect(thumbBytes).toBeInstanceOf(Uint8Array);
        expect(Array.from(thumbBytes)).toEqual(Array.from(TEST_THUMBNAIL_BYTES));
        expect(calls).toEqual([{ filePath: inputPath, maxSize: 50, quality: 70 }]);

        fs.rmSync(tmp, { recursive: true });
    });

    it('throws when no thumbnail generator is configured', async () => {
        const tmp = makeTmpDir();
        const inputPath = path.join(tmp, 'small.jpg');
        fs.writeFileSync(inputPath, 'fake');

        await expect(generateThumbnail(inputPath, 400, 80)).rejects.toThrow(
            'No thumbnail generator configured',
        );

        fs.rmSync(tmp, { recursive: true });
    });
});

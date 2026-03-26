// pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { ingestFolder, updateParentIndex } from './pipeline.js';
import { parseFolderMeta, parseFolderIndex } from './index-html.js';
import type { IngestProgress, FolderMetadata } from './types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

describe('ingestFolder', () => {
    it('processes images and writes one/index.html', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-'));

        // Create a minimal valid JPEG using sharp
        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
        }).jpeg().toBuffer();
        fs.writeFileSync(path.join(tmp, 'test.jpg'), jpegBuffer);

        const progress: IngestProgress[] = [];
        const result = await ingestFolder(tmp, '', (p) => progress.push({ ...p }));

        // Check one/index.html was written
        const indexPath = path.join(tmp, 'one', 'index.html');
        expect(fs.existsSync(indexPath)).toBe(true);

        const html = fs.readFileSync(indexPath, 'utf-8');
        expect(html).toContain('test.jpg');
        expect(html).toContain('data-hash=');

        // Check thumbnail was written
        const thumbsDir = path.join(tmp, 'one', 'thumbs');
        expect(fs.existsSync(thumbsDir)).toBe(true);
        const thumbFiles = fs.readdirSync(thumbsDir);
        expect(thumbFiles.length).toBe(1);

        // Check progress was reported
        expect(progress.some(p => p.phase === 'processing')).toBe(true);
        expect(progress.some(p => p.phase === 'done')).toBe(true);

        // Check result
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].name).toBe('test.jpg');
        expect(result.entries[0].contentHash).toBeTruthy();
        expect(result.entries[0].streamId).toBeTruthy();
        expect(result.entries[0].mime).toBe('image/jpeg');

        fs.rmSync(tmp, { recursive: true });
    });

    it('preserves face data from existing one/index.html', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-preserve-'));

        // Create a minimal valid JPEG
        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 255, b: 0 } },
        }).jpeg().toBuffer();
        fs.writeFileSync(path.join(tmp, 'photo.jpg'), jpegBuffer);

        // First ingest to get the content hash
        const firstResult = await ingestFolder(tmp, '');
        expect(firstResult.entries).toHaveLength(1);
        const contentHash = firstResult.entries[0].contentHash;

        // Manually inject face data into the one/index.html
        const indexPath = path.join(tmp, 'one', 'index.html');
        let html = fs.readFileSync(indexPath, 'utf-8');
        html = html.replace(
            `data-content-hash="${contentHash}"`,
            `data-content-hash="${contentHash}" data-face-count="1" data-face-bboxes="10,20,30,40"`,
        );
        fs.writeFileSync(indexPath, html);

        // Re-ingest — face data should be preserved
        const secondResult = await ingestFolder(tmp, '');
        expect(secondResult.entries).toHaveLength(1);

        // The preserved face data should appear in the written HTML
        const finalHtml = fs.readFileSync(indexPath, 'utf-8');
        expect(finalHtml).toContain('data-face-count="1"');
        expect(finalHtml).toContain('data-face-bboxes="10,20,30,40"');

        fs.rmSync(tmp, { recursive: true });
    });

    it('supports abort via signal', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-abort-'));

        // Create two images
        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 255 } },
        }).jpeg().toBuffer();
        fs.writeFileSync(path.join(tmp, 'a.jpg'), jpegBuffer);
        fs.writeFileSync(path.join(tmp, 'b.jpg'), jpegBuffer);

        // Abort immediately
        const signal = { aborted: true };
        const result = await ingestFolder(tmp, '', undefined, signal);

        // Should have processed nothing (aborted before first image)
        expect(result.entries).toHaveLength(0);
        expect(result.photosProcessed).toBe(0);

        fs.rmSync(tmp, { recursive: true });
    });

    it('handles empty folder', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-empty-'));

        const result = await ingestFolder(tmp, '');
        expect(result.entries).toHaveLength(0);
        expect(result.photosProcessed).toBe(0);

        fs.rmSync(tmp, { recursive: true });
    });

    it('uses relPath for sourcePath and tags', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-rel-'));

        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 128, g: 128, b: 128 } },
        }).jpeg().toBuffer();
        fs.writeFileSync(path.join(tmp, 'sunset.jpg'), jpegBuffer);

        const result = await ingestFolder(tmp, '2024/vacation');

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].sourcePath).toBe('2024/vacation/sunset.jpg');
        expect(result.entries[0].tags).toContain('2024');

        fs.rmSync(tmp, { recursive: true });
    });

    it('returns FolderMetadata with correct counts', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-meta-'));

        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 100, g: 100, b: 100 } },
        }).jpeg().toBuffer();
        fs.writeFileSync(path.join(tmp, 'a.jpg'), jpegBuffer);
        fs.writeFileSync(path.join(tmp, 'b.jpg'), jpegBuffer);

        const result = await ingestFolder(tmp, 'photos/2024');

        expect(result.meta).toBeDefined();
        expect(result.meta.path).toBe('photos/2024');
        expect(result.meta.name).toBe('2024');
        expect(result.meta.localCount).toBe(2);
        expect(result.meta.photoCount).toBe(2); // no children, so same as localCount
        expect(result.meta.childCount).toBe(0);

        fs.rmSync(tmp, { recursive: true });
    });

    it('returns empty FolderMetadata for empty folder', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-emptymeta-'));

        const result = await ingestFolder(tmp, 'empty');

        expect(result.meta).toBeDefined();
        expect(result.meta.path).toBe('empty');
        expect(result.meta.name).toBe('empty');
        expect(result.meta.photoCount).toBe(0);
        expect(result.meta.localCount).toBe(0);
        expect(result.meta.childCount).toBe(0);

        fs.rmSync(tmp, { recursive: true });
    });

    it('discovers child folder metadata from existing child index', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-childmeta-'));

        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 50, g: 50, b: 50 } },
        }).jpeg().toBuffer();

        // Create child folder with images and ingest it first
        const childDir = path.join(tmp, 'vacation');
        fs.mkdirSync(childDir);
        fs.writeFileSync(path.join(childDir, 'beach.jpg'), jpegBuffer);
        fs.writeFileSync(path.join(childDir, 'sunset.jpg'), jpegBuffer);
        await ingestFolder(childDir, 'vacation');

        // Now create parent folder with images and ingest
        fs.writeFileSync(path.join(tmp, 'cover.jpg'), jpegBuffer);
        const result = await ingestFolder(tmp, '');

        // Parent should include child metadata
        expect(result.meta.localCount).toBe(1);
        expect(result.meta.childCount).toBe(1);
        expect(result.meta.photoCount).toBe(3); // 1 local + 2 from child

        // Verify the child metadata is in the written index.html
        const indexPath = path.join(tmp, 'one', 'index.html');
        const html = fs.readFileSync(indexPath, 'utf-8');
        expect(html).toContain('fs-child');
        expect(html).toContain('vacation');

        fs.rmSync(tmp, { recursive: true });
    });
});

describe('updateParentIndex', () => {
    it('creates parent one/index.html with child reference when none exists', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-update-'));

        const childMeta: FolderMetadata = {
            path: 'vacation',
            name: 'vacation',
            photoCount: 42,
            localCount: 42,
            dateRangeStart: '2024-07-01',
            dateRangeEnd: '2024-07-15',
            childCount: 0,
        };

        updateParentIndex(tmp, childMeta, '');

        const indexPath = path.join(tmp, 'one', 'index.html');
        expect(fs.existsSync(indexPath)).toBe(true);

        const html = fs.readFileSync(indexPath, 'utf-8');
        const parsed = parseFolderIndex(html, '');

        expect(parsed.children).toHaveLength(1);
        expect(parsed.children[0].path).toBe('vacation');
        expect(parsed.children[0].photoCount).toBe(42);
        expect(parsed.children[0].dateRangeStart).toBe('2024-07-01');
        expect(parsed.children[0].dateRangeEnd).toBe('2024-07-15');
        expect(parsed.entries).toHaveLength(0);

        // Article meta should reflect the child
        expect(parsed.meta.photoCount).toBe(42);
        expect(parsed.meta.childCount).toBe(1);

        fs.rmSync(tmp, { recursive: true });
    });

    it('updates existing parent with new child metadata', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-update2-'));

        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 200, b: 200 } },
        }).jpeg().toBuffer();

        // Create parent with photos
        fs.writeFileSync(path.join(tmp, 'family.jpg'), jpegBuffer);
        await ingestFolder(tmp, 'photos');

        // Now add a child folder reference
        const childMeta: FolderMetadata = {
            path: 'photos/summer',
            name: 'summer',
            photoCount: 10,
            localCount: 10,
            dateRangeStart: '2024-06-01',
            dateRangeEnd: '2024-08-31',
            childCount: 0,
        };

        updateParentIndex(tmp, childMeta, 'photos');

        const indexPath = path.join(tmp, 'one', 'index.html');
        const html = fs.readFileSync(indexPath, 'utf-8');
        const parsed = parseFolderIndex(html, 'photos');

        // Should have both the original photo and the child reference
        expect(parsed.entries).toHaveLength(1);
        expect(parsed.entries[0].name).toBe('family.jpg');
        expect(parsed.children).toHaveLength(1);
        expect(parsed.children[0].path).toBe('photos/summer');
        expect(parsed.children[0].photoCount).toBe(10);

        // Article meta should include child photos
        expect(parsed.meta.localCount).toBe(1);
        expect(parsed.meta.photoCount).toBe(11); // 1 local + 10 from child

        fs.rmSync(tmp, { recursive: true });
    });

    it('replaces existing child entry by path', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-replace-'));

        // Add initial child reference
        const childMeta1: FolderMetadata = {
            path: 'child',
            name: 'child',
            photoCount: 5,
            localCount: 5,
            childCount: 0,
        };
        updateParentIndex(tmp, childMeta1, '');

        // Update with new metadata for same path
        const childMeta2: FolderMetadata = {
            path: 'child',
            name: 'child',
            photoCount: 15,
            localCount: 15,
            dateRangeStart: '2024-01-01',
            dateRangeEnd: '2024-12-31',
            childCount: 2,
        };
        updateParentIndex(tmp, childMeta2, '');

        const indexPath = path.join(tmp, 'one', 'index.html');
        const html = fs.readFileSync(indexPath, 'utf-8');
        const parsed = parseFolderIndex(html, '');

        // Should still be one child, not two
        expect(parsed.children).toHaveLength(1);
        expect(parsed.children[0].photoCount).toBe(15);
        expect(parsed.children[0].dateRangeStart).toBe('2024-01-01');

        fs.rmSync(tmp, { recursive: true });
    });

    it('nested: ingest child -> update parent -> verify parent metadata', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-nested-'));

        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 30, g: 60, b: 90 } },
        }).jpeg().toBuffer();

        // Create nested structure: root/2024/july/
        const yearDir = path.join(tmp, '2024');
        const monthDir = path.join(yearDir, 'july');
        fs.mkdirSync(monthDir, { recursive: true });

        // Add images to the leaf folder
        fs.writeFileSync(path.join(monthDir, 'photo1.jpg'), jpegBuffer);
        fs.writeFileSync(path.join(monthDir, 'photo2.jpg'), jpegBuffer);
        fs.writeFileSync(path.join(monthDir, 'photo3.jpg'), jpegBuffer);

        // Ingest the leaf folder
        const leafResult = await ingestFolder(monthDir, '2024/july');
        expect(leafResult.meta.localCount).toBe(3);
        expect(leafResult.meta.photoCount).toBe(3);
        expect(leafResult.meta.path).toBe('2024/july');

        // Propagate to parent (2024/)
        updateParentIndex(yearDir, leafResult.meta, '2024');

        // Verify the parent index was created
        const yearIndexPath = path.join(yearDir, 'one', 'index.html');
        expect(fs.existsSync(yearIndexPath)).toBe(true);

        const yearHtml = fs.readFileSync(yearIndexPath, 'utf-8');
        const yearMeta = parseFolderMeta(yearHtml);
        expect(yearMeta.photoCount).toBe(3);
        expect(yearMeta.childCount).toBe(1);

        // Propagate to root
        const yearFullMeta: FolderMetadata = {
            ...yearMeta,
            path: '2024',
            name: '2024',
        };
        updateParentIndex(tmp, yearFullMeta, '');

        // Verify root index
        const rootIndexPath = path.join(tmp, 'one', 'index.html');
        expect(fs.existsSync(rootIndexPath)).toBe(true);

        const rootParsed = parseFolderIndex(
            fs.readFileSync(rootIndexPath, 'utf-8'),
            '',
        );
        expect(rootParsed.meta.photoCount).toBe(3);
        expect(rootParsed.meta.childCount).toBe(1);
        expect(rootParsed.children).toHaveLength(1);
        expect(rootParsed.children[0].path).toBe('2024');
        expect(rootParsed.children[0].photoCount).toBe(3);

        fs.rmSync(tmp, { recursive: true });
    });
});

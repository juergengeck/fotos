// pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { ingestFolder } from './pipeline.js';
import type { IngestProgress } from './types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

describe('ingestFolder', () => {
    it('processes images and writes .one/index.html', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-pipeline-'));

        // Create a minimal valid JPEG using sharp
        const jpegBuffer = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
        }).jpeg().toBuffer();
        fs.writeFileSync(path.join(tmp, 'test.jpg'), jpegBuffer);

        const progress: IngestProgress[] = [];
        const result = await ingestFolder(tmp, '', (p) => progress.push({ ...p }));

        // Check .one/index.html was written
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

    it('preserves face data from existing .one/index.html', async () => {
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

        // Manually inject face data into the .one/index.html
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
});

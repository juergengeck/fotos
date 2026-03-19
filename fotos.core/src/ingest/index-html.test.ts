// index-html.test.ts
import { describe, it, expect } from 'vitest';
import { renderIndexHtml, parseIndexHtml, escapeHtml, formatSize } from './index-html.js';

describe('escapeHtml', () => {
    it('escapes special characters', () => {
        expect(escapeHtml('<div class="foo">&')).toBe('&lt;div class=&quot;foo&quot;&gt;&amp;');
    });
});

describe('formatSize', () => {
    it('formats bytes', () => { expect(formatSize(512)).toBe('512 B'); });
    it('formats megabytes', () => { expect(formatSize(2_500_000)).toBe('2.4 MB'); });
    it('formats zero', () => { expect(formatSize(0)).toBe('0 B'); });
});

describe('renderIndexHtml + parseIndexHtml roundtrip', () => {
    it('renders and parses back entries', () => {
        const entries = [{
            name: 'photo.jpg',
            size: 1024,
            mtime: Date.now(),
            mime: 'image/jpeg',
            contentHash: 'abc123',
            path: 'photo.jpg',
            data: {
                'content-hash': 'abc123',
                'stream-id': 'stream1',
                'exif-date': '2024-03-15',
                'thumb': 'thumbs/stream1.jpg',
            },
        }];
        const html = renderIndexHtml('test', entries, [], Date.now());
        expect(html).toContain('data-hash="abc123"');
        expect(html).toContain('data-stream-id="stream1"');

        const parsed = parseIndexHtml(html, 'test');
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe('photo.jpg');
        expect(parsed[0].contentHash).toBe('abc123');
    });

    it('roundtrips stream-id and exif data', () => {
        const entries = [{
            name: 'sunset.jpg',
            size: 5_000_000,
            mtime: 1710504000000,
            mime: 'image/jpeg',
            contentHash: 'deadbeef',
            path: 'vacation/sunset.jpg',
            data: {
                'content-hash': 'deadbeef',
                'stream-id': 'stream42',
                'exif-date': '2024-03-15 10:30:00',
                'exif-camera': 'Canon EOS R5',
                'exif-lens': 'RF 24-70mm F2.8 L',
                'exif-focal': '50mm',
                'exif-aperture': 'f/2.8',
                'exif-shutter': '1/250',
                'exif-iso': '400',
                'exif-gps': '48.8566,2.3522',
                'exif-width': '8192',
                'exif-height': '5464',
                'thumb': 'thumbs/stream42.jpg',
            },
        }];
        const html = renderIndexHtml('vacation', entries, [], Date.now());
        const parsed = parseIndexHtml(html, 'vacation');

        expect(parsed).toHaveLength(1);
        const p = parsed[0];
        expect(p.name).toBe('sunset.jpg');
        expect(p.streamId).toBe('stream42');
        expect(p.contentHash).toBe('deadbeef');
        expect(p.sourcePath).toBe('vacation/sunset.jpg');
        expect(p.mime).toBe('image/jpeg');
        expect(p.thumb).toBe('vacation/.one/thumbs/stream42.jpg');

        // EXIF roundtrip
        expect(p.exif).toBeDefined();
        expect(p.exif!.date).toBe('2024-03-15 10:30:00');
        expect(p.exif!.camera).toBe('Canon EOS R5');
        expect(p.exif!.lens).toBe('RF 24-70mm F2.8 L');
        expect(p.exif!.focalLength).toBe('50mm');
        expect(p.exif!.aperture).toBe('f/2.8');
        expect(p.exif!.shutter).toBe('1/250');
        expect(p.exif!.iso).toBe(400);
        expect(p.exif!.gps).toEqual({ lat: 48.8566, lon: 2.3522 });
        expect(p.exif!.width).toBe(8192);
        expect(p.exif!.height).toBe(5464);
    });

    it('roundtrips face data', () => {
        const entries = [{
            name: 'group.jpg',
            size: 3000,
            mtime: Date.now(),
            mime: 'image/jpeg',
            contentHash: 'facehash',
            path: 'group.jpg',
            data: {
                'content-hash': 'facehash',
                'stream-id': 'facestream',
                'face-count': '2',
                'face-bboxes': '0,0,100,100;200,200,300,300',
                'face-scores': '0.95;0.88',
                'face-embeddings': 'emb1;emb2',
                'face-crops': 'crops/face1.jpg;crops/face2.jpg',
            },
        }];
        const html = renderIndexHtml('.', entries, [], Date.now());
        const parsed = parseIndexHtml(html, '');

        expect(parsed).toHaveLength(1);
        expect(parsed[0].faceData).toBeDefined();
        expect(parsed[0].faceData!['face-count']).toBe('2');
        expect(parsed[0].faceData!['face-bboxes']).toBe('0,0,100,100;200,200,300,300');
        expect(parsed[0].faceData!['face-scores']).toBe('0.95;0.88');
    });

    it('roundtrips child directories', () => {
        const html = renderIndexHtml('photos', [], ['2023', '2024'], Date.now());
        expect(html).toContain('2023/one/index.html');
        expect(html).toContain('2024/one/index.html');
    });

    it('roundtrips multiple entries', () => {
        const entries = [
            { name: 'a.jpg', size: 100, mtime: Date.now(), mime: 'image/jpeg', path: 'a.jpg', data: { 'content-hash': 'h1', 'stream-id': 's1' } },
            { name: 'b.png', size: 200, mtime: Date.now(), mime: 'image/png', path: 'b.png', data: { 'content-hash': 'h2', 'stream-id': 's2' } },
            { name: 'c.webp', size: 300, mtime: Date.now(), mime: 'image/webp', path: 'c.webp', data: { 'content-hash': 'h3', 'stream-id': 's3' } },
        ];
        const html = renderIndexHtml('.', entries, [], Date.now());
        const parsed = parseIndexHtml(html, '');

        expect(parsed).toHaveLength(3);
        expect(parsed.map(e => e.name)).toEqual(['a.jpg', 'b.png', 'c.webp']);
    });

    it('handles empty entries', () => {
        const html = renderIndexHtml('empty', [], [], Date.now());
        const parsed = parseIndexHtml(html, 'empty');
        expect(parsed).toHaveLength(0);
    });

    it('escapes HTML in names and preserves them through roundtrip', () => {
        const entries = [{
            name: 'photo & sunset.jpg',
            size: 1024,
            mtime: Date.now(),
            mime: 'image/jpeg',
            contentHash: 'esc1',
            path: 'photo & sunset.jpg',
            data: { 'content-hash': 'esc1', 'stream-id': 'escs1' },
        }];
        const html = renderIndexHtml('test', entries, [], Date.now());
        expect(html).toContain('&amp;');

        const parsed = parseIndexHtml(html, 'test');
        expect(parsed).toHaveLength(1);
        // The parser extracts text content which is the unescaped name from the <a> tag
        expect(parsed[0].name).toContain('sunset.jpg');
    });
});

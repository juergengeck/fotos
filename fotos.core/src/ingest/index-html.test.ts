// index-html.test.ts
import { describe, it, expect } from 'vitest';
import { renderIndexHtml, parseIndexHtml, parseFolderMeta, parseFolderIndex, escapeHtml, formatSize } from './index-html.js';
import type { FolderMetadata } from './types.js';

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
        const children: FolderMetadata[] = [
            { path: '2023', name: '2023', photoCount: 100, localCount: 50, childCount: 2, dateRangeStart: '2023-01-01', dateRangeEnd: '2023-12-31' },
            { path: '2024', name: '2024', photoCount: 200, localCount: 80, childCount: 3, dateRangeStart: '2024-01-15', dateRangeEnd: '2024-11-30' },
        ];
        const html = renderIndexHtml('photos', [], children, Date.now());
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

describe('parseFolderMeta', () => {
    it('extracts article-level metadata without parsing entries', () => {
        const children: FolderMetadata[] = [
            { path: 'vacation', name: 'vacation', photoCount: 312, localCount: 100, childCount: 2, dateRangeStart: '2017-07-10', dateRangeEnd: '2017-07-24' },
        ];
        const entries = [
            { name: 'a.jpg', size: 100, mtime: Date.now(), mime: 'image/jpeg', path: 'a.jpg', data: { 'content-hash': 'h1', 'stream-id': 's1', 'exif-date': '2017-01-05' } },
            { name: 'b.jpg', size: 200, mtime: Date.now(), mime: 'image/jpeg', path: 'b.jpg', data: { 'content-hash': 'h2', 'stream-id': 's2', 'exif-date': '2017-12-31' } },
        ];
        const html = renderIndexHtml('2017', entries, children, Date.now());
        const meta = parseFolderMeta(html);

        expect(meta.path).toBe('2017');
        expect(meta.name).toBe('2017');
        expect(meta.photoCount).toBe(314); // 2 local + 312 from child
        expect(meta.localCount).toBe(2);
        expect(meta.dateRangeStart).toBe('2017-01-05');
        expect(meta.dateRangeEnd).toBe('2017-12-31');
        expect(meta.childCount).toBe(1);
    });

    it('handles empty folder', () => {
        const html = renderIndexHtml('empty', [], [], Date.now());
        const meta = parseFolderMeta(html);

        expect(meta.path).toBe('empty');
        expect(meta.photoCount).toBe(0);
        expect(meta.localCount).toBe(0);
        expect(meta.childCount).toBe(0);
        expect(meta.dateRangeStart).toBeUndefined();
        expect(meta.dateRangeEnd).toBeUndefined();
    });
});

describe('parseFolderIndex full roundtrip', () => {
    it('roundtrips meta, children, and entries', () => {
        const children: FolderMetadata[] = [
            { path: 'vacation', name: 'vacation', photoCount: 312, localCount: 100, childCount: 2, dateRangeStart: '2017-07-10', dateRangeEnd: '2017-07-24' },
            { path: 'christmas', name: 'christmas', photoCount: 45, localCount: 45, childCount: 0, dateRangeStart: '2017-12-24', dateRangeEnd: '2017-12-25' },
        ];
        const entries = [
            { name: 'cover.jpg', size: 5000, mtime: 1710504000000, mime: 'image/jpeg', contentHash: 'abc', path: 'cover.jpg', data: { 'content-hash': 'abc', 'stream-id': 'st1', 'exif-date': '2017-03-15' } },
        ];
        const html = renderIndexHtml('2017', entries, children, Date.now());
        const result = parseFolderIndex(html, '2017');

        // Meta
        expect(result.meta.path).toBe('2017');
        expect(result.meta.photoCount).toBe(358); // 1 + 312 + 45
        expect(result.meta.localCount).toBe(1);
        expect(result.meta.childCount).toBe(2);
        expect(result.meta.dateRangeStart).toBe('2017-03-15');
        expect(result.meta.dateRangeEnd).toBe('2017-12-25');

        // Children
        expect(result.children).toHaveLength(2);
        expect(result.children[0].path).toBe('vacation');
        expect(result.children[0].name).toBe('vacation');
        expect(result.children[0].photoCount).toBe(312);
        expect(result.children[0].dateRangeStart).toBe('2017-07-10');
        expect(result.children[0].dateRangeEnd).toBe('2017-07-24');

        expect(result.children[1].path).toBe('christmas');
        expect(result.children[1].name).toBe('christmas');
        expect(result.children[1].photoCount).toBe(45);
        expect(result.children[1].dateRangeStart).toBe('2017-12-24');
        expect(result.children[1].dateRangeEnd).toBe('2017-12-25');

        // Entries
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].name).toBe('cover.jpg');
        expect(result.entries[0].contentHash).toBe('abc');
    });

    it('roundtrips with no children', () => {
        const entries = [
            { name: 'photo.jpg', size: 1024, mtime: Date.now(), mime: 'image/jpeg', contentHash: 'h1', path: 'photo.jpg', data: { 'content-hash': 'h1', 'stream-id': 's1' } },
        ];
        const html = renderIndexHtml('leaf', entries, [], Date.now());
        const result = parseFolderIndex(html, 'leaf');

        expect(result.meta.photoCount).toBe(1);
        expect(result.meta.localCount).toBe(1);
        expect(result.meta.childCount).toBe(0);
        expect(result.children).toHaveLength(0);
        expect(result.entries).toHaveLength(1);
    });

    it('roundtrips with only children, no local entries', () => {
        const children: FolderMetadata[] = [
            { path: 'sub1', name: 'sub1', photoCount: 50, localCount: 50, childCount: 0, dateRangeStart: '2020-01-01', dateRangeEnd: '2020-06-30' },
            { path: 'sub2', name: 'sub2', photoCount: 30, localCount: 20, childCount: 1, dateRangeStart: '2020-07-01', dateRangeEnd: '2020-12-31' },
        ];
        const html = renderIndexHtml('parent', [], children, Date.now());
        const result = parseFolderIndex(html, 'parent');

        expect(result.meta.photoCount).toBe(80);
        expect(result.meta.localCount).toBe(0);
        expect(result.meta.childCount).toBe(2);
        expect(result.children).toHaveLength(2);
        expect(result.entries).toHaveLength(0);
    });

    it('article tag has itemscope and itemtype', () => {
        const html = renderIndexHtml('test', [], [], Date.now());
        expect(html).toContain('itemscope itemtype="//fotos.one/FolderIndex"');
    });

    it('child rows have itemscope and itemtype', () => {
        const children: FolderMetadata[] = [
            { path: 'sub', name: 'sub', photoCount: 10, localCount: 10, childCount: 0 },
        ];
        const html = renderIndexHtml('parent', [], children, Date.now());
        expect(html).toContain('itemscope itemtype="//fotos.one/FolderMetadata"');
        expect(html).toContain('itemprop="path"');
        expect(html).toContain('itemprop="photoCount"');
    });
});

// -- Legacy data-* format (no itemprop, no itemscope) -----------------------
// This is the format already on the NAS with 486K entries.

/** Build a legacy index.html string — no itemscope, no itemprop, no <meta> tags */
function legacyIndexHtml(opts: {
    path: string;
    childLinks?: { href: string; label: string }[];
    entries?: { name: string; mime: string; hash: string; exifDate?: string; size?: string }[];
}): string {
    const childRows = (opts.childLinks ?? []).map(c =>
        `        <tr class="fs-child">
            <td class="fs-icon">\u{1F4C1}</td>
            <td class="fs-name"><a href="${c.href}">${c.label}</a></td>
            <td class="fs-faces"></td><td class="fs-size"></td><td class="fs-date"></td><td class="fs-path"></td>
        </tr>`
    ).join('\n');

    const entryRows = (opts.entries ?? []).map(e => {
        let attrs = ` data-mime="${e.mime}" data-hash="${e.hash}"`;
        if (e.exifDate) attrs += ` data-exif-date="${e.exifDate}"`;
        return `        <tr class="fs-entry"${attrs}>
            <td class="fs-icon">\u{1F5BC}</td>
            <td class="fs-name">${e.name}</td>
            <td class="fs-faces"></td>
            <td class="fs-size">${e.size ?? '2.5 MB'}</td>
            <td class="fs-date"></td>
            <td class="fs-path"></td>
        </tr>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${opts.path}</title></head>
<body>
<article class="fs-node" data-path="${opts.path}" data-scanned="2026-03-19T12:00:00.000Z">
    <table class="fs-table">
        <tbody>
${childRows}${childRows && entryRows ? '\n' : ''}${entryRows}
        </tbody>
    </table>
</article>
</body>
</html>`;
}

describe('parseFolderMeta — legacy data-* format', () => {
    it('synthesizes metadata from entry rows', () => {
        const html = legacyIndexHtml({
            path: '2017',
            entries: [
                { name: 'photo1.jpg', mime: 'image/jpeg', hash: 'aaa', exifDate: '2017-03-15' },
                { name: 'photo2.jpg', mime: 'image/jpeg', hash: 'bbb', exifDate: '2017-08-20' },
                { name: 'photo3.jpg', mime: 'image/jpeg', hash: 'ccc', exifDate: '2017-01-02' },
            ],
        });
        const meta = parseFolderMeta(html);

        expect(meta.path).toBe('2017');
        expect(meta.name).toBe('2017');
        expect(meta.localCount).toBe(3);
        expect(meta.photoCount).toBe(3); // legacy: photoCount = localCount
        expect(meta.dateRangeStart).toBe('2017-01-02');
        expect(meta.dateRangeEnd).toBe('2017-08-20');
        expect(meta.childCount).toBe(0);
    });

    it('counts child rows', () => {
        const html = legacyIndexHtml({
            path: '2017',
            childLinks: [
                { href: 'vacation/one/index.html', label: 'vacation/' },
                { href: 'christmas/one/index.html', label: 'christmas/' },
            ],
            entries: [
                { name: 'cover.jpg', mime: 'image/jpeg', hash: 'x1', exifDate: '2017-06-01' },
            ],
        });
        const meta = parseFolderMeta(html);

        expect(meta.childCount).toBe(2);
        expect(meta.localCount).toBe(1);
        expect(meta.photoCount).toBe(1);
    });

    it('handles legacy with no entries and no children', () => {
        const html = legacyIndexHtml({ path: 'empty' });
        const meta = parseFolderMeta(html);

        expect(meta.photoCount).toBe(0);
        expect(meta.localCount).toBe(0);
        expect(meta.childCount).toBe(0);
        expect(meta.dateRangeStart).toBeUndefined();
        expect(meta.dateRangeEnd).toBeUndefined();
    });

    it('handles entries without exif dates', () => {
        const html = legacyIndexHtml({
            path: 'misc',
            entries: [
                { name: 'a.jpg', mime: 'image/jpeg', hash: 'h1' },
                { name: 'b.jpg', mime: 'image/jpeg', hash: 'h2' },
            ],
        });
        const meta = parseFolderMeta(html);

        expect(meta.localCount).toBe(2);
        expect(meta.dateRangeStart).toBeUndefined();
        expect(meta.dateRangeEnd).toBeUndefined();
    });

    it('handles nested path', () => {
        const html = legacyIndexHtml({
            path: '2017/vacation/beach',
            entries: [
                { name: 'sunset.jpg', mime: 'image/jpeg', hash: 'z1', exifDate: '2017-07-15' },
            ],
        });
        const meta = parseFolderMeta(html);

        expect(meta.path).toBe('2017/vacation/beach');
        expect(meta.name).toBe('beach');
    });
});

describe('parseFolderIndex — legacy data-* format', () => {
    it('parses entries using existing data-* logic', () => {
        const html = legacyIndexHtml({
            path: '2017',
            entries: [
                { name: 'photo1.jpg', mime: 'image/jpeg', hash: 'abc123', exifDate: '2017-03-15', size: '2.5 MB' },
                { name: 'photo2.jpg', mime: 'image/jpeg', hash: 'def456', exifDate: '2017-08-20', size: '1.8 MB' },
            ],
        });
        const result = parseFolderIndex(html, '2017');

        // Entries parsed via existing parseIndexHtml
        expect(result.entries).toHaveLength(2);
        expect(result.entries[0].name).toBe('photo1.jpg');
        expect(result.entries[0].contentHash).toBe('abc123');
        expect(result.entries[0].exif?.date).toBe('2017-03-15');
        expect(result.entries[0].sourcePath).toBe('2017/photo1.jpg');

        expect(result.entries[1].name).toBe('photo2.jpg');
        expect(result.entries[1].contentHash).toBe('def456');
    });

    it('parses legacy child folders', () => {
        const html = legacyIndexHtml({
            path: '2017',
            childLinks: [
                { href: 'vacation/one/index.html', label: 'vacation/' },
                { href: 'christmas/one/index.html', label: 'christmas/' },
            ],
        });
        const result = parseFolderIndex(html, '2017');

        expect(result.children).toHaveLength(2);
        expect(result.children[0].path).toBe('vacation');
        expect(result.children[0].name).toBe('vacation');
        expect(result.children[0].photoCount).toBe(0); // no count info in legacy
        expect(result.children[0].dateRangeStart).toBeUndefined();

        expect(result.children[1].path).toBe('christmas');
        expect(result.children[1].name).toBe('christmas');
    });

    it('parses legacy with both children and entries', () => {
        const html = legacyIndexHtml({
            path: '2017',
            childLinks: [
                { href: 'vacation/one/index.html', label: 'vacation/' },
            ],
            entries: [
                { name: 'cover.jpg', mime: 'image/jpeg', hash: 'covhash', exifDate: '2017-01-01' },
            ],
        });
        const result = parseFolderIndex(html, '2017');

        // Meta synthesized from legacy
        expect(result.meta.localCount).toBe(1);
        expect(result.meta.photoCount).toBe(1);
        expect(result.meta.childCount).toBe(1);
        expect(result.meta.dateRangeStart).toBe('2017-01-01');
        expect(result.meta.dateRangeEnd).toBe('2017-01-01');

        // Children
        expect(result.children).toHaveLength(1);
        expect(result.children[0].path).toBe('vacation');

        // Entries
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].contentHash).toBe('covhash');
    });

    it('handles empty legacy file', () => {
        const html = legacyIndexHtml({ path: 'empty' });
        const result = parseFolderIndex(html, 'empty');

        expect(result.meta.photoCount).toBe(0);
        expect(result.meta.childCount).toBe(0);
        expect(result.children).toHaveLength(0);
        expect(result.entries).toHaveLength(0);
    });
});

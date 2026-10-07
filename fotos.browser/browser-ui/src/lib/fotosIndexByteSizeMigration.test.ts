// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {readFotosIndexWithExactByteSizes} from './fotosIndexByteSizeMigration.js';

const legacyIndex = `<!DOCTYPE html><html><head><style>.fs-entry { color: red; }</style></head><body>
<div class="fs-node" data-scanned="2025-01-02T12:00:00Z"></div><table><tbody>
<tr class="fs-entry" data-mime="image/jpeg" data-stream-id="stream" data-content-hash="content" data-thumb="thumbs/photo.jpg" data-face-count="1" data-face-names="Ada &amp; Grace" data-face-cluster-hashes="cluster" data-face-person-ids="person" data-face-embeddings="AAECAw==" data-semantic-model-id="model" data-semantic-embedding="BAUGBw=="><td class="fs-name"><a href="../photo &amp; family.jpg"><img src="thumbs/photo.jpg"></a><a href="../photo &amp; family.jpg">photo &amp; family.jpg</a></td><td class="fs-faces"><span>Ada &amp; Grace</span></td><td class="fs-size">14 KB</td></tr>
<tr class="fs-entry" data-mime="video/mp4"><td class="fs-name">clip.mp4</td><td class="fs-size">2 MB</td></tr>
<tr class="fs-entry" data-mime="text/plain"><td class="fs-name">notes.txt</td></tr>
</tbody></table><script>window.kept = 'metadata';</script></body></html>`;

function fixture(html: string, sizes: Record<string, number>) {
    let savedHtml = html;
    const write = vi.fn(async (value: string) => { savedHtml = value; });
    const close = vi.fn(async () => {});
    const abort = vi.fn(async () => {});
    const createWritable = vi.fn(async () => ({write, close, abort}));
    const indexHandle = {getFile: async () => ({text: async () => savedHtml}), createWritable} as unknown as FileSystemFileHandle;
    const getFileHandle = vi.fn(async (name: string) => {
        if (!(name in sizes)) throw new DOMException('Original file is missing', 'NotFoundError');
        return {getFile: async () => ({size: sizes[name]})};
    });
    const sourceDirectory = {getFileHandle} as unknown as FileSystemDirectoryHandle;
    return {indexHandle, sourceDirectory, getFileHandle, createWritable, write, close, abort, saved: () => savedHtml};
}

describe('legacy Fotos exact byte size migration', () => {
    it('reads exact original file sizes and preserves every existing attribute and metadata cell', async () => {
        const source = fixture(legacyIndex, {'photo & family.jpg': 14321, 'clip.mp4': 2097321});
        const migrated = await readFotosIndexWithExactByteSizes(source.indexHandle, source.sourceDirectory, 'album/one/index.html');
        const before = new DOMParser().parseFromString(legacyIndex, 'text/html');
        const after = new DOMParser().parseFromString(migrated, 'text/html');
        const rows = after.querySelectorAll('tr.fs-entry');
        expect(rows[0].getAttribute('data-size-bytes')).toBe('14321');
        expect(rows[1].getAttribute('data-size-bytes')).toBe('2097321');
        expect(rows[2].hasAttribute('data-size-bytes')).toBe(false);
        rows[0].removeAttribute('data-size-bytes');
        rows[1].removeAttribute('data-size-bytes');
        expect(after.documentElement.outerHTML).toBe(before.documentElement.outerHTML);
        expect(source.write).toHaveBeenCalledOnce();
        expect(source.close).toHaveBeenCalledOnce();
        expect(source.saved()).toBe(migrated);
        expect(source.getFileHandle.mock.calls.map(([name]) => name)).toEqual(['photo & family.jpg', 'clip.mp4']);
    });

    it('does not reopen originals or rewrite an already migrated index', async () => {
        const source = fixture(legacyIndex, {'photo & family.jpg': 14321, 'clip.mp4': 0});
        const migrated = await readFotosIndexWithExactByteSizes(source.indexHandle, source.sourceDirectory, 'one/index.html');
        source.getFileHandle.mockClear();
        source.write.mockClear();
        expect(await readFotosIndexWithExactByteSizes(source.indexHandle, source.sourceDirectory, 'one/index.html')).toBe(migrated);
        expect(source.getFileHandle).not.toHaveBeenCalled();
        expect(source.write).not.toHaveBeenCalled();
        expect(migrated).toContain('data-size-bytes="0"');
    });

    it('leaves existing exact sizes intact and migrates only missing media sizes', async () => {
        const html = legacyIndex.replace('data-mime="image/jpeg"', 'data-mime="image/jpeg" data-size-bytes="14321"');
        const source = fixture(html, {'clip.mp4': 2097321});
        await readFotosIndexWithExactByteSizes(source.indexHandle, source.sourceDirectory, 'one/index.html');
        expect(source.getFileHandle).toHaveBeenCalledExactlyOnceWith('clip.mp4');
        expect(source.saved()).toContain('data-size-bytes="14321"');
    });

    it('reports a missing original with its index path and does not write a partial migration', async () => {
        const source = fixture(legacyIndex, {'photo & family.jpg': 14321});
        await expect(readFotosIndexWithExactByteSizes(source.indexHandle, source.sourceDirectory, 'album/one/index.html')).rejects.toThrow('Cannot migrate album/one/index.html: could not read original “clip.mp4”');
        expect(source.createWritable).not.toHaveBeenCalled();
        expect(source.saved()).toBe(legacyIndex);
    });

    it('reports write permission failure without claiming the index was migrated', async () => {
        const source = fixture(legacyIndex, {'photo & family.jpg': 14321, 'clip.mp4': 2097321});
        source.createWritable.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
        await expect(readFotosIndexWithExactByteSizes(source.indexHandle, source.sourceDirectory, 'one/index.html')).rejects.toThrow('Grant write access to this folder and reopen it');
        expect(source.saved()).toBe(legacyIndex);
    });

    it('aborts an unsuccessful write and reports the failed index', async () => {
        const source = fixture(legacyIndex, {'photo & family.jpg': 14321, 'clip.mp4': 2097321});
        source.write.mockRejectedValue(new Error('Disk full'));
        await expect(readFotosIndexWithExactByteSizes(source.indexHandle, source.sourceDirectory, 'one/index.html')).rejects.toThrow('Cannot save exact file sizes to one/index.html');
        expect(source.abort).toHaveBeenCalledOnce();
        expect(source.close).not.toHaveBeenCalled();
    });
});

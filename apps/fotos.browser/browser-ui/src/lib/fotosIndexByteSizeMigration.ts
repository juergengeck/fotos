/**
 * Upgrade old Fotos indexes from the originals, without regenerating their
 * thumbnails, face annotations, semantic embeddings, or other metadata.
 * The caller serializes this operation with other index writers.
 */
export async function readFotosIndexWithExactByteSizes(
    indexHandle: FileSystemFileHandle,
    sourceDirectory: FileSystemDirectoryHandle,
    indexPath: string,
): Promise<string> {
    const html = await (await indexHandle.getFile()).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const missingRows = Array.from(doc.querySelectorAll('tr.fs-entry')).filter(row => {
        const mime = row.getAttribute('data-mime') ?? '';
        return (mime.startsWith('image/') || mime.startsWith('video/')) && !row.hasAttribute('data-size-bytes');
    });
    if (missingRows.length === 0) return html;

    const sizes = new Map<string, number>();
    for (const row of missingRows) {
        const nameCell = row.querySelector('.fs-name');
        const name = (nameCell?.querySelector('a:last-of-type')?.textContent ?? nameCell?.textContent)?.trim();
        if (!name) throw new Error(`Cannot migrate ${indexPath}: a media entry has no original filename.`);
        let size = sizes.get(name);
        if (size === undefined) {
            try {
                const original = await (await sourceDirectory.getFileHandle(name)).getFile();
                size = original.size;
                if (!Number.isSafeInteger(size) || size < 0) throw new Error('The original file has an invalid byte size.');
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(`Cannot migrate ${indexPath}: could not read original “${name}” for its exact byte size. ${detail}`);
            }
            sizes.set(name, size);
        }
        row.setAttribute('data-size-bytes', String(size));
    }

    const migratedHtml = `${doc.doctype ? '<!DOCTYPE html>\n' : ''}${doc.documentElement.outerHTML}`;
    try {
        const writable = await indexHandle.createWritable();
        try {
            await writable.write(migratedHtml);
            await writable.close();
        } catch (error) {
            await writable.abort().catch(() => {});
            throw error;
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot save exact file sizes to ${indexPath}. Grant write access to this folder and reopen it. ${detail}`);
    }
    return migratedHtml;
}

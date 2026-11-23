export interface FotosPhotoKitContinuation {
    nextOffset?: number;
    cursor?: string;
}

/** Visit a stable native snapshot and release its cursor if the caller stops early. */
export async function visitFotosPhotoKitPages<Page extends FotosPhotoKitContinuation>(
    read: (offset: number, cursor?: string) => Promise<Page>,
    release: (cursor: string) => void | Promise<void>,
    visit: (page: Page) => boolean | void,
): Promise<void> {
    let offset = 0;
    let cursor: string | undefined;
    try {
        for (;;) {
            const page = await read(offset, cursor);
            const continuation = page.cursor;
            const nextOffset = page.nextOffset;
            const previousCursor = cursor;
            if (typeof continuation === 'string' && continuation) cursor = continuation;
            if (nextOffset === undefined && continuation === undefined) {
                cursor = undefined;
                visit(page);
                return;
            }
            if (typeof nextOffset !== 'number' || !Number.isSafeInteger(nextOffset) || nextOffset <= offset
                || typeof continuation !== 'string' || !continuation) {
                throw new Error('Invalid or nonadvancing PhotoKit page offset or cursor');
            }
            if (previousCursor && continuation !== previousCursor) {
                await release(previousCursor);
                throw new Error('PhotoKit cursor changed during pagination');
            }
            if (visit(page) === false) return;
            offset = nextOffset;
        }
    } finally {
        if (cursor) await release(cursor);
    }
}

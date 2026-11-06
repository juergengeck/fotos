import { afterEach, describe, expect, it, vi } from 'vitest';

import { canShareFiles, shareFile, shareFiles } from './platform';

function setNavigatorShareMocks(options: {
    canShare?: ReturnType<typeof vi.fn>;
    share?: ReturnType<typeof vi.fn>;
}) {
    Object.defineProperty(globalThis.navigator, 'canShare', {
        configurable: true,
        value: options.canShare,
    });
    Object.defineProperty(globalThis.navigator, 'share', {
        configurable: true,
        value: options.share,
    });
}

describe('platform share helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports file sharing support only when navigator can share the files', () => {
        const canShare = vi.fn().mockReturnValue(true);
        setNavigatorShareMocks({
            canShare,
            share: vi.fn(),
        });

        const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
        expect(canShareFiles([file])).toBe(true);
        expect(canShare).toHaveBeenCalledWith({ files: [file] });
    });

    it('returns false when the share sheet is unavailable for the files', async () => {
        setNavigatorShareMocks({
            canShare: vi.fn().mockReturnValue(false),
            share: vi.fn(),
        });

        const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
        await expect(shareFiles([file])).resolves.toBe(false);
    });

    it('treats user cancellation as a non-error', async () => {
        setNavigatorShareMocks({
            canShare: vi.fn().mockReturnValue(true),
            share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
        });

        const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
        await expect(shareFile(file)).resolves.toBe(false);
    });
});

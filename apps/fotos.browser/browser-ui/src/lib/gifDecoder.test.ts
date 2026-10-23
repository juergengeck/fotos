import {afterEach, describe, expect, it, vi} from 'vitest';
import {decodeGifInWorker} from './gifDecoder.js';

class DecoderWorker {
    static latest: DecoderWorker;
    onmessage?: (event: {data: unknown}) => void;
    onerror?: (event: unknown) => void;
    onmessageerror?: () => void;
    postMessage = vi.fn();
    terminate = vi.fn();

    constructor() { DecoderWorker.latest = this; }
}

afterEach(() => vi.unstubAllGlobals());

describe('isolated GIF decoding', () => {
    it('terminates active decoding when navigation aborts', async () => {
        vi.stubGlobal('Worker', DecoderWorker);
        const controller = new AbortController();
        const result = decodeGifInWorker(new ArrayBuffer(4), controller.signal);
        controller.abort();
        await expect(result).rejects.toMatchObject({name: 'AbortError'});
        expect(DecoderWorker.latest.terminate).toHaveBeenCalledOnce();
    });

    it('transfers the input and releases the worker after successful decoding', async () => {
        vi.stubGlobal('Worker', DecoderWorker);
        const bytes = new ArrayBuffer(4);
        const result = decodeGifInWorker(bytes);
        expect(DecoderWorker.latest.postMessage).toHaveBeenCalledWith(bytes, [bytes]);
        const animation = {width: 1, height: 1, frames: [], durationMs: 0, loopCount: null};
        DecoderWorker.latest.onmessage?.({data: {animation}});
        await expect(result).resolves.toBe(animation);
        expect(DecoderWorker.latest.terminate).toHaveBeenCalledOnce();
    });

    it('surfaces decode failures and releases the worker', async () => {
        vi.stubGlobal('Worker', DecoderWorker);
        const result = decodeGifInWorker(new ArrayBuffer(4));
        DecoderWorker.latest.onmessage?.({data: {error: 'Invalid GIF: truncated frame'}});
        await expect(result).rejects.toThrow('Invalid GIF: truncated frame');
        expect(DecoderWorker.latest.terminate).toHaveBeenCalledOnce();
    });

    it('does not launch a decoder for an already cancelled load', async () => {
        const Worker = vi.fn();
        vi.stubGlobal('Worker', Worker);
        const controller = new AbortController();
        controller.abort();
        await expect(decodeGifInWorker(new ArrayBuffer(4), controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(Worker).not.toHaveBeenCalled();
    });
});

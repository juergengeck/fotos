import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createExpoQuicVCTransport} from './createExpoQuicVCTransport';

const native = vi.hoisted(() => ({
    available: vi.fn(), create: vi.fn(), bind: vi.fn(), send: vi.fn(), close: vi.fn(),
    listeners: new Map<string, (event: any) => void>(),
}));
vi.mock('./expo-udp-socket', () => ({
    isNativeUdpAvailable: native.available,
    createUDPSocket: native.create,
}));

beforeEach(() => {
    vi.resetAllMocks();
    native.listeners.clear();
    native.available.mockReturnValue(true);
    native.create.mockResolvedValue({
        on: (event: string, listener: (event: any) => void) => native.listeners.set(event, listener),
        bind: native.bind, send: native.send, close: native.close,
    });
    native.bind.mockResolvedValue(undefined);
    native.send.mockResolvedValue(undefined);
    native.close.mockResolvedValue(undefined);
});

describe('native QUICVC transport', () => {
    it('preserves outgoing byte views and delivers datagrams with their remote address', async () => {
        const {transport, port, close} = await createExpoQuicVCTransport(49497);
        expect(port).toBe(49497);
        expect(native.bind).toHaveBeenCalledWith(49497, '0.0.0.0');
        const received = vi.fn();
        transport.on('message', received);
        const bytes = Uint8Array.of(99, 1, 2, 88).subarray(1, 3);
        await transport.send(bytes, '192.0.2.1', 49500);
        expect(native.send).toHaveBeenCalledWith(bytes, 49500, '192.0.2.1');
        native.listeners.get('message')?.({data: Uint8Array.of(3, 4).buffer, address: '192.0.2.2', port: 49501});
        expect(received).toHaveBeenCalledWith(Uint8Array.of(3, 4), {address: '192.0.2.2', port: 49501});
        await Promise.all([close(), close()]);
        expect(native.close).toHaveBeenCalledOnce();
        native.listeners.get('message')?.({data: new ArrayBuffer(0), address: '192.0.2.2', port: 49501});
        expect(received).toHaveBeenCalledOnce();
        await expect(transport.send(bytes, '192.0.2.1', 49500)).rejects.toThrow('closed');
    });

    it('rejects invalid ports and absent native support before creating a socket', async () => {
        await expect(createExpoQuicVCTransport(0)).rejects.toThrow('Invalid QUICVC port');
        native.available.mockReturnValue(false);
        await expect(createExpoQuicVCTransport(49497)).rejects.toThrow('Native UDP is unavailable');
        expect(native.create).not.toHaveBeenCalled();
    });

    it('closes the socket after bind failure and retains cleanup errors', async () => {
        const bindError = new Error('address in use');
        const closeError = new Error('close failed');
        native.bind.mockRejectedValue(bindError);
        native.close.mockRejectedValue(closeError);
        await expect(createExpoQuicVCTransport(49497)).rejects.toMatchObject({errors: [bindError, closeError]});
        expect(native.close).toHaveBeenCalledOnce();
    });

    it('propagates native failure through subsequent transport sends', async () => {
        const {transport, close} = await createExpoQuicVCTransport(49497);
        native.listeners.get('error')?.({error: 'native network failed'});
        await expect(transport.send(Uint8Array.of(1), '192.0.2.1', 49500)).rejects.toThrow('native network failed');
        expect(native.send).not.toHaveBeenCalled();
        await close();
    });
});

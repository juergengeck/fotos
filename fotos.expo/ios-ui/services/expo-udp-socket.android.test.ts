import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createUDPSocket} from './expo-udp-socket.android';

const native = vi.hoisted(() => ({
    create: vi.fn(), bind: vi.fn(), send: vi.fn(), close: vi.fn(), broadcast: vi.fn(),
    listeners: new Map<string, (...args: any[]) => void>(),
}));
vi.mock('react-native', () => ({NativeModules: {UdpSockets: {}}}));
vi.mock('react-native-udp', () => ({default: {createSocket: native.create}}));

beforeEach(() => {
    vi.resetAllMocks();
    native.listeners.clear();
    native.create.mockReturnValue({
        on: (event: string, listener: (...args: any[]) => void) => native.listeners.set(event, listener),
        bind: native.bind, send: native.send, close: native.close, setBroadcast: native.broadcast,
    });
    native.bind.mockImplementation((_port, _address, complete) => complete());
    native.send.mockImplementation((_data, _offset, _length, _port, _address, complete) => complete());
    native.close.mockImplementation(complete => {
        native.listeners.get('close')?.();
        complete();
    });
});

describe('Android native UDP adapter', () => {
    it('copies only received view bytes and sends the exact outgoing view', async () => {
        const socket = await createUDPSocket({reuseAddr: true, broadcast: true});
        expect(native.create).toHaveBeenCalledWith({type: 'udp4', reusePort: true});
        await socket.bind(49497, '0.0.0.0');
        expect(native.broadcast).toHaveBeenCalledWith(true);
        const listener = vi.fn();
        socket.on('message', listener);
        const bytes = Uint8Array.of(99, 1, 2, 88).subarray(1, 3);
        native.listeners.get('message')?.(bytes, {address: '192.0.2.1', port: 49500});
        expect(new Uint8Array(listener.mock.calls[0][0].data)).toEqual(Uint8Array.of(1, 2));
        await socket.send(bytes, 49500, '192.0.2.1');
        expect(native.send).toHaveBeenCalledWith(bytes, 0, 2, 49500, '192.0.2.1', expect.any(Function));
        await Promise.all([socket.close(), socket.close()]);
        expect(native.close).toHaveBeenCalledOnce();
    });

    it('rejects a pending bind when native closes the socket', async () => {
        native.bind.mockImplementation(() => {});
        const socket = await createUDPSocket();
        const bound = socket.bind(49497, '0.0.0.0');
        native.listeners.get('close')?.();
        await expect(bound).rejects.toThrow('closed');
    });

    it('rejects pending sends on a native error without waiting for callbacks', async () => {
        native.send.mockImplementation(() => {});
        const socket = await createUDPSocket();
        await socket.bind(49497, '0.0.0.0');
        const sent = socket.send(Uint8Array.of(1), 49500, '192.0.2.1');
        native.listeners.get('error')?.(new Error('send failed'));
        await expect(sent).rejects.toThrow('send failed');
        await expect(socket.send(Uint8Array.of(2), 49500, '192.0.2.1')).rejects.toThrow('send failed');
        await socket.close();
    });

    it('rejects a failed native close and keeps concurrent callers on the same completion', async () => {
        native.close.mockImplementation(() => {});
        const socket = await createUDPSocket();
        const closed = socket.close();
        expect(socket.close()).toBe(closed);
        native.listeners.get('error')?.('close failed');
        await expect(closed).rejects.toThrow('close failed');
        expect(native.close).toHaveBeenCalledOnce();
    });
});

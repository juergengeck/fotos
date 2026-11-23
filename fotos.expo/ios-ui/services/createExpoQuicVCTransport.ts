import {createUDPSocket, isNativeUdpAvailable} from './expo-udp-socket';
import type {IQuicTransport} from '@refinio/connection.core/services/QuicVCConnectionManager.js';

export async function createExpoQuicVCTransport(port: number) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid QUICVC port');
    if (!isNativeUdpAvailable()) throw new Error('Native UDP is unavailable; rebuild the app with UDP support');
    const socket = await createUDPSocket({type: 'udp4'});
    const listeners = new Set<(data: Uint8Array, address: {address: string; port: number}) => void>();
    let closed = false;
    let failure: Error | undefined;
    let closePromise: Promise<void> | undefined;

    socket.on('message', event => {
        if (closed || failure) return;
        const bytes = new Uint8Array(event.data);
        for (const listener of listeners) listener(bytes, {address: event.address, port: event.port});
    });
    socket.on('error', event => {
        failure = new Error(`QUICVC UDP: ${event.error}`);
    });
    socket.on('close', event => {
        closed = true;
        if (event.error) failure = new Error(`QUICVC UDP closed: ${event.error}`);
    });

    const close = (): Promise<void> => {
        listeners.clear();
        if (closePromise) return closePromise;
        if (closed) return Promise.resolve();
        closed = true;
        closePromise = socket.close();
        return closePromise;
    };

    try {
        await socket.bind(port, '0.0.0.0');
        if (failure) throw failure;
        if (closed) throw new Error('QUICVC UDP transport closed while binding');
    } catch (error) {
        try {
            await close();
        } catch (closeError) {
            throw new AggregateError([error, closeError], 'QUICVC UDP bind and cleanup failed');
        }
        throw error;
    }

    const transport: IQuicTransport = {
        async send(data, address, targetPort) {
            if (failure) throw failure;
            if (closed) throw new Error('QUICVC UDP transport is closed');
            await socket.send(data, targetPort, address);
        },
        on(event, listener) {
            if (event !== 'message') throw new Error(`Unsupported QUICVC UDP event: ${event}`);
            if (closed) throw new Error('QUICVC UDP transport is closed');
            listeners.add(listener);
        },
    };
    return {transport, port, close};
}

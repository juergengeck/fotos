import dgram from 'react-native-udp';
import {NativeModules} from 'react-native';
import type {UDPCloseEvent, UDPErrorEvent, UDPMessageEvent, UDPSocketOptions} from 'react-native-udp-ios';

export type {UDPCloseEvent, UDPErrorEvent, UDPMessageEvent, UDPSocketOptions};
type Events = {message: UDPMessageEvent; error: UDPErrorEvent; close: UDPCloseEvent};

export interface ExpoUDPSocket {
    on<K extends keyof Events>(event: K, listener: (event: Events[K]) => void): void;
    bind(port: number, address: string): Promise<void>;
    send(data: Uint8Array, port: number, address: string): Promise<void>;
    close(): Promise<void>;
}

export function isNativeUdpAvailable(): boolean {
    return !!NativeModules.UdpSockets;
}

let nextSocketId = 0;

/** Adapt Android datagram callbacks to the native socket interface used by QUICVC. */
export async function createUDPSocket(options: UDPSocketOptions = {}): Promise<ExpoUDPSocket> {
    if (!isNativeUdpAvailable()) throw new Error('Native UDP is unavailable; rebuild the Android development client');
    const socket = dgram.createSocket({type: options.type ?? 'udp4', reusePort: options.reuseAddr});
    const socketId = `android-udp-${nextSocketId++}`;
    const listeners = new Map<keyof Events, Set<(value: any) => void>>();
    const pending = new Set<(error: Error) => void>();
    let closed = false;
    let failure: Error | undefined;
    let closePromise: Promise<void> | undefined;
    let rejectClose: ((error: Error) => void) | undefined;

    function emit<K extends keyof Events>(event: K, value: Events[K]): void {
        for (const listener of listeners.get(event) ?? []) listener(value);
    }

    function rejectPending(error: Error): void {
        for (const reject of pending) reject(error);
        pending.clear();
    }

    function perform(work: (complete: (error?: Error) => void) => void): Promise<void> {
        if (failure) return Promise.reject(failure);
        if (closed) return Promise.reject(new Error('UDP socket is closed'));
        let rejectOperation: (error: Error) => void;
        return new Promise<void>((resolve, reject) => {
            rejectOperation = reject;
            pending.add(reject);
            work(error => error ? reject(error) : resolve());
        }).finally(() => pending.delete(rejectOperation));
    }

    socket.on('message', (data: Uint8Array, remote: {address: string; port: number}) => {
        if (closed) return;
        emit('message', {socketId, data: Uint8Array.from(data).buffer, address: remote.address, port: remote.port});
    });
    socket.on('error', (error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
        rejectPending(failure);
        rejectClose?.(failure);
        emit('error', {socketId, error: failure.message});
    });
    socket.on('close', () => {
        closed = true;
        rejectPending(new Error('UDP socket is closed'));
        emit('close', {socketId});
    });

    return {
        on(event, listener) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(listener);
        },
        async bind(port, address) {
            await perform(complete => socket.bind(port, address, complete));
            if (options.broadcast) socket.setBroadcast(true);
        },
        async send(data, port, address) {
            await perform(complete => socket.send(data, 0, data.byteLength, port, address, complete));
        },
        close() {
            if (closePromise) return closePromise;
            if (closed) return Promise.resolve();
            closed = true;
            rejectPending(new Error('UDP socket is closed'));
            closePromise = new Promise<void>((resolve, reject) => {
                rejectClose = reject;
                socket.close(() => resolve());
            }).finally(() => {
                rejectClose = undefined;
                listeners.clear();
            });
            return closePromise;
        },
    };
}

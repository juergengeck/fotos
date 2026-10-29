import { Platform } from 'react-native';
import type { Transport } from '@refinio/connection.core';

export interface UdpTransportOptions {
  connectTimeout?: number;
}

type TransportState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

interface ParsedAddress {
  host: string;
  port: number;
}

interface IOSUdpSocket {
  bind(port: number, address: string): Promise<void>;
  send(data: Uint8Array, port: number, host: string): Promise<void>;
  close(): Promise<void>;
  on(event: 'message', listener: (event: { data: ArrayBufferLike }) => void): void;
  on(event: 'error', listener: (event: { error: unknown }) => void): void;
  on(event: 'close', listener: (event: { error?: unknown }) => void): void;
}

interface IOSUdpModule {
  createUDPSocket(options: { type: 'udp4'; reuseAddr: boolean }): Promise<IOSUdpSocket>;
  isJSIAvailable(): boolean;
}

const DEFAULT_HANDSHAKE_PORT = 8766;
const UNSUPPORTED_MESSAGE =
  'QUICVC UDP transport is not wired for this platform yet. The runtime shell is available, but peer pairing remains gated.';

function parseAddress(address: string): ParsedAddress {
  const separatorIndex = address.lastIndexOf(':');
  const hasExplicitPort = separatorIndex > 0 && separatorIndex < address.length - 1;
  const host = hasExplicitPort ? address.slice(0, separatorIndex) : address;
  const portString = hasExplicitPort ? address.slice(separatorIndex + 1) : '';
  const port = portString ? Number.parseInt(portString, 10) : DEFAULT_HANDSHAKE_PORT;

  if (!host) {
    throw new Error(`Invalid UDP address: ${address}`);
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid UDP port in address: ${address}`);
  }

  return { host, port };
}

function createUnsupportedTransport(): Transport {
  let state: TransportState = 'disconnected';
  let stateCallback: ((state: TransportState) => void) | null = null;

  const setState = (nextState: TransportState): void => {
    if (state === nextState) {
      return;
    }

    state = nextState;
    stateCallback?.(state);
  };

  return {
    type: 'quicvc',

    connect: async (): Promise<void> => {
      setState('connecting');
      setState('disconnected');
      throw new Error(UNSUPPORTED_MESSAGE);
    },

    send: async (): Promise<void> => {
      throw new Error(UNSUPPORTED_MESSAGE);
    },

    onReceive: (): void => {},

    onStateChange: (callback: (state: TransportState) => void): void => {
      stateCallback = callback;
    },

    close: (): void => {
      setState('disconnected');
    },

    getState: (): TransportState => state,
  };
}

function getIOSUdpModule(): IOSUdpModule {
  if (Platform.OS !== 'ios') {
    throw new Error(UNSUPPORTED_MESSAGE);
  }

  return require('react-native-udp-ios') as IOSUdpModule;
}

export async function createUdpTransport(
  address: string,
  options: UdpTransportOptions = {}
): Promise<Transport> {
  if (Platform.OS !== 'ios') {
    return createUnsupportedTransport();
  }

  const { connectTimeout = 5000 } = options;
  const { createUDPSocket, isJSIAvailable } = getIOSUdpModule();

  let remoteAddress = parseAddress(address);
  let socket: IOSUdpSocket | null = null;
  let state: TransportState = 'disconnected';
  let stateCallback: ((state: TransportState) => void) | null = null;
  let receiveCallback: ((data: Uint8Array) => void) | null = null;

  const setState = (nextState: TransportState): void => {
    if (state === nextState) {
      return;
    }

    state = nextState;
    stateCallback?.(state);
  };

  const ensureSocket = async (): Promise<IOSUdpSocket> => {
    if (socket) {
      return socket;
    }

    if (!isJSIAvailable()) {
      throw new Error(
        'UDP JSI bindings are not available. Rebuild the iOS app after installing react-native-udp-ios.'
      );
    }

    const createdSocket = await createUDPSocket({
      type: 'udp4',
      reuseAddr: true,
    });

    createdSocket.on('message', (event) => {
      receiveCallback?.(new Uint8Array(event.data));
    });

    createdSocket.on('error', (event) => {
      console.error('[UdpTransport-iOS] Socket error:', event.error);
      setState('disconnected');
    });

    createdSocket.on('close', (event) => {
      if (event.error) {
        console.warn('[UdpTransport-iOS] Socket closed with error:', event.error);
      }
      socket = null;
      setState('disconnected');
    });

    socket = createdSocket;
    return createdSocket;
  };

  const closeSocket = async (): Promise<void> => {
    const currentSocket = socket;
    socket = null;

    if (!currentSocket) {
      return;
    }

    try {
      await currentSocket.close();
    } catch (error) {
      console.warn('[UdpTransport-iOS] Failed to close socket cleanly:', error);
    }
  };

  const transport: Transport = {
    type: 'quicvc',

    connect: async (targetAddress: string): Promise<void> => {
      if (state === 'connected' || state === 'connecting') {
        return;
      }

      remoteAddress = parseAddress(targetAddress);
      setState('connecting');

      const currentSocket = await ensureSocket();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        await Promise.race([
          currentSocket.bind(0, '0.0.0.0'),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error(`UDP bind timed out after ${connectTimeout}ms`));
            }, connectTimeout);
          }),
        ]);

        console.log(
          '[UdpTransport-iOS] Bound local UDP socket for',
          `${remoteAddress.host}:${remoteAddress.port}`
        );
        setState('connected');
      } catch (error) {
        await closeSocket();
        setState('disconnected');
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    },

    send: async (data: Uint8Array): Promise<void> => {
      if (!socket || state !== 'connected') {
        throw new Error('UDP socket not connected');
      }

      await socket.send(data, remoteAddress.port, remoteAddress.host);
    },

    onReceive: (callback: (data: Uint8Array) => void): void => {
      receiveCallback = callback;
    },

    onStateChange: (callback: (state: TransportState) => void): void => {
      stateCallback = callback;
    },

    close: (): void => {
      if (state === 'disconnected' || state === 'disconnecting') {
        return;
      }

      setState('disconnecting');
      void closeSocket().finally(() => {
        setState('disconnected');
      });
    },

    getState: (): TransportState => state,
  };

  return transport;
}

export function createTransportFactory(options: UdpTransportOptions = {}): (address: string) => Promise<Transport> {
  return async (address: string) => createUdpTransport(address, options);
}

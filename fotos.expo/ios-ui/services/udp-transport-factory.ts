import type { Transport } from '@refinio/connection.core';
import {
  createUDPSocket,
  isJSIAvailable,
  type UDPCloseEvent,
  type UDPErrorEvent,
  type UDPMessageEvent,
  type UDPSocketJSI,
} from 'react-native-udp-ios';

export interface UdpTransportOptions {
  connectTimeout?: number;
}

type TransportState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

interface ParsedAddress {
  host: string;
  port: number;
}

const DEFAULT_HANDSHAKE_PORT = 8766;

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

export async function createUdpTransport(
  address: string,
  options: UdpTransportOptions = {}
): Promise<Transport> {
  const { connectTimeout = 5000 } = options;

  let remoteAddress = parseAddress(address);
  let socket: UDPSocketJSI | null = null;
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

  const ensureSocket = async (): Promise<UDPSocketJSI> => {
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

    createdSocket.on('message', (event: UDPMessageEvent) => {
      receiveCallback?.(new Uint8Array(event.data));
    });

    createdSocket.on('error', (event: UDPErrorEvent) => {
      console.error('[UdpTransport-iOS] Socket error:', event.error);
      setState('disconnected');
    });

    createdSocket.on('close', (event: UDPCloseEvent) => {
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

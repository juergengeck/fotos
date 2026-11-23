import {createCommserverSignalingAuthResponder} from '@refinio/connection.core';
import {QuicVCConnectionManager} from '@refinio/connection.core/services/QuicVCConnectionManager.js';
import {createCryptoApiFromDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import type {Instance, Person} from '@refinio/one.core/lib/recipes.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {WebRTCTransport} from '@refinio/transport.browser';
import type {ConnectionModule} from '@vger/vger.core/modules/ConnectionModule.js';
import {createPublicKeyTrustVerifier} from '@vger/vger.core/services/public-key-trust-provider.js';
import {
    createDirectWebSocketConnectFn, createDiscoveryTransportMatcher, createQuicVCConnectFn, createQuicVCDialFn,
} from '@vger/vger.core/services/quicvc-transport-setup.js';
import {
    createWebRTCConnectFn, ManagedWebRTCDirectTransport,
} from '@vger/vger.core/services/webrtc-direct-transport.js';
import {createExpoQuicVCTransport} from './createExpoQuicVCTransport';

// Fotos, Akte and VGER can run side by side on a device.
export const FOTOS_QUICVC_PORT = 49498;

export async function createFotosDirectTransports(params: {
    connection: ConnectionModule;
    ownerId: SHA256IdHash<Person>;
    instanceId: SHA256IdHash<Instance>;
    commServerUrl: string;
    assertCurrent: () => void;
}) {
    const {connection, ownerId, instanceId, commServerUrl, assertCurrent} = params;
    const cryptoApi = await createCryptoApiFromDefaultKeys(instanceId);
    const {registerGlobals} = await import('react-native-webrtc');
    assertCurrent();
    registerGlobals();

    const localPublicKeyHex = uint8arrayToHexString(cryptoApi.publicEncryptionKey);
    const manager = QuicVCConnectionManager.createIsolated(ownerId);
    const udp = await createExpoQuicVCTransport(FOTOS_QUICVC_PORT);
    let webRTCConnect: ReturnType<typeof createWebRTCConnectFn> | undefined;
    let webRTCListener: ManagedWebRTCDirectTransport | undefined;
    let stopping: Promise<void> | undefined;
    const assertActive = () => {
        if (stopping) throw new Error('Fotos direct transports are closed');
        assertCurrent();
    };
    const stop = () => stopping ??= (async () => {
        const results = await Promise.allSettled([
            Promise.resolve().then(() => webRTCConnect?.stop()),
            Promise.resolve().then(() => webRTCListener?.stop()),
            ...manager.getConnections().map(peer => Promise.resolve().then(() => manager.disconnect(peer.deviceId))),
        ]);
        manager.clearTransport();
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        try { await udp.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Fotos direct transport shutdown failed');
    })();

    try {
        assertActive();
        manager.setSignCallback(async bytes => {
            assertActive();
            return cryptoApi.sign(bytes);
        });
        await manager.initialize(udp.transport, {id: instanceId, credentialSubject: {
            id: instanceId, personId: ownerId, publicKeyHex: localPublicKeyHex,
            publicSignKey: uint8arrayToHexString(cryptoApi.publicSignKey), signAlgorithm: 'ed25519',
        }});
        const webRTCOptions = {commServerUrl, localPublicKeyHex,
            respondToAuthRequest: createCommserverSignalingAuthResponder(cryptoApi)};
        const createWebRTCTransport = (channel: ConstructorParameters<typeof WebRTCTransport>[0], signal?: AbortSignal) =>
            new WebRTCTransport(channel, signal);
        webRTCConnect = createWebRTCConnectFn(webRTCOptions, createWebRTCTransport);
        const listener = new ManagedWebRTCDirectTransport({
            ...webRTCOptions, ownerId, instanceId, assertCurrent: assertActive, connectionModule: connection,
        }, createWebRTCTransport);
        webRTCListener = listener;

        const quicConnectFn = createQuicVCConnectFn(manager);
        const matcher = createDiscoveryTransportMatcher({
            connectionModule: connection, ownerId, quicManager: manager, localPublicKeyHex,
            quicConnectFn: createQuicVCDialFn(manager),
            webSocketConnectFn: createDirectWebSocketConnectFn(), webRTCConnectFn: webRTCConnect,
        });
        connection.setQuicVCConnectFn(quicConnectFn);
        connection.setTransportMatcher(matcher);
        return {
            manager, matcher, port: udp.port, localPublicKeyHex,
            start(trustModel: unknown) {
                assertActive();
                manager.setTrustVerifier(createPublicKeyTrustVerifier(trustModel));
                listener.start();
            },
            stop,
        };
    } catch (error) {
        try { await stop(); } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Fotos direct transport startup and cleanup failed', {cause: error});
        }
        throw error;
    }
}

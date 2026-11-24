import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Instance, Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ConnectionModule} from '@vger/vger.core/modules/ConnectionModule.js';
import {createFotosDirectTransports, FOTOS_QUICVC_PORT} from './FotosDirectTransports';

const fakes = vi.hoisted(() => {
    const manager = {
        initialize: vi.fn(), setSignCallback: vi.fn(), setTrustVerifier: vi.fn(), getConnections: vi.fn(),
        disconnect: vi.fn(), clearTransport: vi.fn(),
    };
    return {
        manager, udp: {transport: {}, close: vi.fn()}, quicConnect: vi.fn(), quicDial: vi.fn(),
        webSocketDial: vi.fn(), webRTCDial: Object.assign(vi.fn(), {stop: vi.fn()}),
        webRTCStart: vi.fn(), webRTCStop: vi.fn(), registerGlobals: vi.fn(), matcher: vi.fn(),
    };
});
vi.mock('./createExpoQuicVCTransport', () => ({createExpoQuicVCTransport: async (port: number) => ({...fakes.udp, port})}));
vi.mock('react-native-webrtc', () => ({registerGlobals: fakes.registerGlobals}));
vi.mock('@refinio/connection.core', () => ({createCommserverSignalingAuthResponder: vi.fn()}));
vi.mock('@refinio/connection.core/services/QuicVCConnectionManager.js', () => ({
    QuicVCConnectionManager: {createIsolated: () => fakes.manager},
}));
vi.mock('@refinio/transport.browser', () => ({WebRTCTransport: class {}}));
vi.mock('@refinio/one.core/lib/keychain/keychain.js', () => ({createCryptoApiFromDefaultKeys: async () => ({
    publicEncryptionKey: Uint8Array.of(1, 2), publicSignKey: Uint8Array.of(3, 4), sign: vi.fn(),
})}));
vi.mock('@vger/vger.core/services/public-key-trust-provider.js', () => ({createPublicKeyTrustVerifier: (trust: unknown) => trust}));
vi.mock('@vger/vger.core/services/quicvc-transport-setup.js', () => ({
    createQuicVCConnectFn: () => fakes.quicConnect, createQuicVCDialFn: () => fakes.quicDial,
    createDirectWebSocketConnectFn: () => fakes.webSocketDial, createDiscoveryTransportMatcher: fakes.matcher,
}));
vi.mock('@vger/vger.core/services/webrtc-direct-transport.js', () => ({
    createWebRTCConnectFn: () => fakes.webRTCDial,
    ManagedWebRTCDirectTransport: class {start = fakes.webRTCStart; stop = fakes.webRTCStop;},
}));

const ownerId = 'a'.repeat(64) as SHA256IdHash<Person>;
const instanceId = 'b'.repeat(64) as SHA256IdHash<Instance>;

function fixture() {
    const connection = {setQuicVCConnectFn: vi.fn(), setTransportMatcher: vi.fn()};
    const assertCurrent = vi.fn();
    const params = {connection: connection as unknown as ConnectionModule, ownerId, instanceId,
        commServerUrl: 'wss://localhost.test', assertCurrent};
    return {params, connection, assertCurrent};
}

beforeEach(() => {
    vi.resetAllMocks();
    fakes.manager.getConnections.mockReturnValue([]);
});

describe('Fotos direct transport lifecycle', () => {
    it('uses the instance key and registers a peer-key dial separately from ONE routes', async () => {
        const {params, connection} = fixture();
        const direct = await createFotosDirectTransports(params);
        expect(direct.port).toBe(FOTOS_QUICVC_PORT);
        expect(fakes.manager.initialize).toHaveBeenCalledWith(fakes.udp.transport, {
            id: instanceId, credentialSubject: {id: instanceId, personId: ownerId,
                publicKeyHex: '0102', publicSignKey: '0304', signAlgorithm: 'ed25519'},
        });
        expect(connection.setQuicVCConnectFn).toHaveBeenCalledWith(fakes.quicConnect);
        expect(fakes.matcher).toHaveBeenCalledWith(expect.objectContaining({
            quicConnectFn: fakes.quicDial, webSocketConnectFn: fakes.webSocketDial, webRTCConnectFn: fakes.webRTCDial,
        }));
        expect(fakes.webRTCStart).not.toHaveBeenCalled();
        const verifier = {};
        direct.start(verifier);
        expect(fakes.manager.setTrustVerifier).toHaveBeenCalledBefore(fakes.webRTCStart);
        expect(fakes.manager.setTrustVerifier).toHaveBeenCalledWith(verifier);
        await direct.stop();
        expect(() => direct.start(verifier)).toThrow('closed');
    });

    it('closes the bound UDP socket if manager startup fails', async () => {
        const failure = new Error('Unable to initialize local credential');
        fakes.manager.initialize.mockRejectedValueOnce(failure);
        await expect(createFotosDirectTransports(fixture().params)).rejects.toBe(failure);
        expect(fakes.udp.close).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.manager.clearTransport).toHaveBeenCalledExactlyOnceWith();
    });

    it('closes each transport once even when a peer disconnect fails', async () => {
        fakes.manager.getConnections.mockReturnValue([{deviceId: 'peer'}]);
        fakes.manager.disconnect.mockImplementationOnce(() => {throw new Error('failed disconnect');});
        const direct = await createFotosDirectTransports(fixture().params);
        const stopping = direct.stop();
        expect(direct.stop()).toBe(stopping);
        await expect(stopping).rejects.toThrow('transport shutdown failed');
        expect(fakes.manager.clearTransport).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.udp.close).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.webRTCStop).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.webRTCDial.stop).toHaveBeenCalledExactlyOnceWith();
    });
});

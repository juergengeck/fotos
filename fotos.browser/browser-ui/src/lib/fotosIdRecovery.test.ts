import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runFotosRecoveryFlow } from './fotosIdRecovery.ts';

type MessageHandler = (event: { origin: string; source: unknown; data?: unknown }) => void;

function createJsonResponse(body: unknown, options?: { ok?: boolean; status?: number }): Response {
    return {
        ok: options?.ok ?? true,
        status: options?.status ?? 200,
        json: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
}

function createWindowHarness() {
    const handlers = new Set<MessageHandler>();
    const popupWindow = {
        closed: false,
        close: vi.fn(() => {
            popupWindow.closed = true;
        }),
        postMessage: vi.fn(),
    };
    const windowMock = {
        location: { href: 'https://fotos.one/settings' },
        open: vi.fn(() => popupWindow),
        addEventListener: vi.fn((type: string, handler: MessageHandler) => {
            if (type === 'message') {
                handlers.add(handler);
            }
        }),
        removeEventListener: vi.fn((type: string, handler: MessageHandler) => {
            if (type === 'message') {
                handlers.delete(handler);
            }
        }),
    };

    return {
        popupWindow,
        windowMock,
        dispatch(origin: string, data: unknown, source: unknown = popupWindow) {
            for (const handler of handlers) {
                handler({ origin, source, data });
            }
        },
    };
}

async function flushMicrotasks(turns = 4): Promise<void> {
    for (let index = 0; index < turns; index += 1) {
        await Promise.resolve();
    }
}

describe('runFotosRecoveryFlow', () => {
    const originalWindow = globalThis.window;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (originalWindow === undefined) {
            delete (globalThis as { window?: Window }).window;
        } else {
            globalThis.window = originalWindow;
        }
    });

    it('completes the fotos recovery handshake and submits the signed claim', async () => {
        const harness = createWindowHarness();
        globalThis.window = harness.windowMock as unknown as Window & typeof globalThis;

        const fetchImpl = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse({
                success: true,
                data: {
                    challengeId: 'challenge-1',
                    challenge: 'challenge-value-1',
                    fotosPublicKey: 'fotos-key-1',
                },
            }))
            .mockResolvedValueOnce(createJsonResponse({
                success: true,
                data: {
                    cert: { certId: 'cert-1' },
                },
            }));
        const getFotosRecoveryTarget = vi.fn().mockResolvedValue({
            personId: 'person-1',
            personPublicKeyHex: 'glue-key-1',
            instanceEncryptionKeyHex: 'instance-key-1',
        });
        const signClaimWithGlueKey = vi.fn().mockResolvedValue('glue-signature-1');

        const recoveryPromise = runFotosRecoveryFlow({
            requestedDisplayName: 'Fester',
            requestedIdentity: 'fester',
            getFotosRecoveryTarget,
            signClaimWithGlueKey,
            fetchImpl,
            apiBase: 'https://api.fotos.one',
        });

        await flushMicrotasks();

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://api.fotos.one/api/registration/fotos/recover-begin',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ name: 'fester' }),
            }),
        );
        expect(harness.windowMock.open).toHaveBeenCalledTimes(1);

        harness.dispatch('https://fotos.one', { type: 'fotos-id-ready' });

        expect(harness.popupWindow.postMessage).toHaveBeenCalledTimes(1);
        const [requestPayload, targetOrigin] = harness.popupWindow.postMessage.mock.calls[0];
        expect(targetOrigin).toBe('https://fotos.one');
        expect(requestPayload).toMatchObject({
            type: 'fotos-id-request',
            mode: 'recover',
            displayName: 'Fester',
            personId: 'person-1',
            personPublicKey: 'glue-key-1',
            challengeId: 'challenge-1',
            challenge: 'challenge-value-1',
            expectedFotosPublicKey: 'fotos-key-1',
        });

        harness.dispatch('https://fotos.one', {
            type: 'fotos-id-result',
            requestId: requestPayload.requestId,
            success: true,
            data: {
                mode: 'recover',
                identity: 'fester',
                displayName: 'Fester',
                claimPayload: 'claim-payload-1',
                signature: 'fotos-signature-1',
            },
        });

        await expect(recoveryPromise).resolves.toEqual({
            personId: 'person-1',
            fotosIdentity: 'fester',
            fotosDisplayName: 'Fester',
            cert: { certId: 'cert-1' },
        });

        expect(getFotosRecoveryTarget).toHaveBeenCalledTimes(1);
        expect(signClaimWithGlueKey).toHaveBeenCalledWith('person-1', 'claim-payload-1');
        expect(fetchImpl).toHaveBeenCalledTimes(2);

        const recoverRequest = fetchImpl.mock.calls[1]?.[1];
        expect(recoverRequest).toBeDefined();
        expect(JSON.parse(String(recoverRequest?.body))).toEqual({
            claimPayload: 'claim-payload-1',
            glueSignature: 'glue-signature-1',
            fotosSignature: 'fotos-signature-1',
            instanceEncryptionKey: 'instance-key-1',
        });
    });

    it('rejects the recovery flow when the popup returns a different identity', async () => {
        const harness = createWindowHarness();
        globalThis.window = harness.windowMock as unknown as Window & typeof globalThis;

        const fetchImpl = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse({
                success: true,
                data: {
                    challengeId: 'challenge-1',
                    challenge: 'challenge-value-1',
                    fotosPublicKey: 'fotos-key-1',
                },
            }));
        const signClaimWithGlueKey = vi.fn().mockResolvedValue('glue-signature-1');

        const recoveryPromise = runFotosRecoveryFlow({
            requestedDisplayName: 'Fester',
            requestedIdentity: 'fester',
            getFotosRecoveryTarget: async () => ({
                personId: 'person-1',
                personPublicKeyHex: 'glue-key-1',
                instanceEncryptionKeyHex: 'instance-key-1',
            }),
            signClaimWithGlueKey,
            fetchImpl,
            apiBase: 'https://api.fotos.one',
        });

        await flushMicrotasks();
        harness.dispatch('https://fotos.one', { type: 'fotos-id-ready' });

        const [requestPayload] = harness.popupWindow.postMessage.mock.calls[0];
        harness.dispatch('https://fotos.one', {
            type: 'fotos-id-result',
            requestId: requestPayload.requestId,
            success: true,
            data: {
                mode: 'recover',
                identity: 'morticia',
                displayName: 'Fester',
                claimPayload: 'claim-payload-1',
                signature: 'fotos-signature-1',
            },
        });

        await expect(recoveryPromise).rejects.toThrow('Fotos recovery returned morticia, expected fester');
        expect(signClaimWithGlueKey).not.toHaveBeenCalled();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});

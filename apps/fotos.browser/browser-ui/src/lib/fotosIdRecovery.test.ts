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
    const context = { identity: 'fester@glue.one', personId: 'person-1', gluePublicKey: 'glue-key-1',
        challengeId: 'challenge-1', challenge: 'challenge-value-1' };
    const proof = (fotosPublicKey: string, overrides = {}) => ({ claimPayload: JSON.stringify({
        $type$: 'FotosNameClaim', action: 'recover', ...context, fotosPublicKey, ...overrides,
    }), signature: `signature-${fotosPublicKey}` });

    beforeEach(() => { vi.clearAllMocks(); });
    afterEach(() => {
        if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
        else globalThis.window = originalWindow;
    });

    async function startRecovery(recoveryProofs: unknown, completion = { success: true,
        data: { cert: { certId: 'cert-1' } } } as any, identity = context.identity) {
        const harness = createWindowHarness();
        globalThis.window = harness.windowMock as unknown as Window & typeof globalThis;
        const fetchImpl = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse({ success: true,
                data: { challengeId: context.challengeId, challenge: context.challenge } }))
            .mockResolvedValueOnce(createJsonResponse(completion, { ok: completion.success, status: completion.success ? 200 : 403 }));
        const signClaimWithGlueKey = vi.fn().mockResolvedValue('glue-signature-1');
        const promise = runFotosRecoveryFlow({ requestedDisplayName: 'Fester', requestedIdentity: context.identity,
            getFotosRecoveryTarget: async () => ({ personId: context.personId, personPublicKeyHex: context.gluePublicKey,
                instanceEncryptionKeyHex: 'instance-key-1' }), signClaimWithGlueKey, fetchImpl, apiBase: 'https://api.fotos.one' });
        await flushMicrotasks();
        harness.dispatch('https://fotos.one', { type: 'fotos-id-ready' });
        const [request] = harness.popupWindow.postMessage.mock.calls[0];
        harness.dispatch('https://fotos.one', { type: 'fotos-id-result', requestId: request.requestId, success: true,
            data: { mode: 'recover', identity, displayName: 'Fester', recoveryProofs } });
        return { promise, harness, request, fetchImpl, signClaimWithGlueKey };
    }

    it('signs and submits the complete candidate batch without receiving a proof key', async () => {
        const proofs = ['current', 'raw-current', 'legacy'].map(key => proof(key));
        const { promise, request, fetchImpl, signClaimWithGlueKey } = await startRecovery(proofs);
        await expect(promise).resolves.toEqual({ personId: context.personId, fotosIdentity: context.identity,
            fotosDisplayName: 'Fester', cert: { certId: 'cert-1' } });
        expect(request).toMatchObject({ mode: 'recover', displayName: 'Fester', personId: context.personId,
            personPublicKey: context.gluePublicKey, challengeId: context.challengeId, challenge: context.challenge });
        expect(request).not.toHaveProperty('expectedFotosPublicKey');
        expect(signClaimWithGlueKey).toHaveBeenCalledTimes(3);
        proofs.forEach((p, i) => expect(signClaimWithGlueKey).toHaveBeenNthCalledWith(i + 1, context.personId, p.claimPayload));
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
            recoveryProofs: proofs.map(p => ({ claimPayload: p.claimPayload, glueSignature: 'glue-signature-1', fotosSignature: p.signature })),
            instanceEncryptionKey: 'instance-key-1',
        });
    });

    it.each([undefined, null, [], [proof('a'), proof('b'), proof('c'), proof('d')],
        [{ claimPayload: '', signature: 'sig' }], [{ claimPayload: '{}', signature: '' }]])(
        'rejects malformed or unbounded proof batches before signing (%j)', async proofs => {
            const { promise, fetchImpl, signClaimWithGlueKey } = await startRecovery(proofs);
            await expect(promise).rejects.toThrow();
            expect(signClaimWithGlueKey).not.toHaveBeenCalled();
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

    it.each(['identity', 'personId', 'gluePublicKey', 'challengeId', 'challenge', 'action', '$type$', 'fotosPublicKey'])(
        'checks every candidate %s before any Glue signature', async field => {
            const { promise, fetchImpl, signClaimWithGlueKey } = await startRecovery([proof('current'), proof('legacy', { [field]: '' })]);
            await expect(promise).rejects.toThrow('does not match the requested recovery');
            expect(signClaimWithGlueKey).not.toHaveBeenCalled();
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

    it('rejects a popup result for another identity', async () => {
        const { promise, signClaimWithGlueKey } = await startRecovery([proof('current')], undefined, 'morticia@glue.one');
        await expect(promise).rejects.toThrow('Fotos recovery returned morticia@glue.one, expected fester@glue.one');
        expect(signClaimWithGlueKey).not.toHaveBeenCalled();
    });

    it('propagates the online registrar error without candidate retries', async () => {
        const { promise, fetchImpl } = await startRecovery([proof('current'), proof('legacy')],
            { success: false, error: 'Fotos proof key does not match the registered binding' });
        await expect(promise).rejects.toThrow('Fotos proof key does not match the registered binding');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});

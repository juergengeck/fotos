import { API_BASE } from '../config.js';

const POPUP_TIMEOUT_MS = 5 * 60 * 1000;

function generateRequestId(): string {
    return `fotos-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJsonResponse(response: Response): Promise<any> {
    return response.json().catch(() => null);
}

function getFotosIdPopupUrl(mode: 'recover', displayName?: string): string {
    const url = new URL('/fotos-id', window.location.href);
    url.searchParams.set('mode', mode);
    if (displayName) {
        url.searchParams.set('displayName', displayName);
    }
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

interface FotosIdResult {
    success: boolean;
    data?: {
        mode: 'create' | 'recover';
        identity: string;
        displayName: string;
        publicKey: string;
        claimPayload?: string;
        signature?: string;
    };
    error?: string;
}

interface OpenFotosRecoveryPopupOptions {
    mode: 'recover';
    displayName?: string;
    personId: string;
    personPublicKey: string;
    challengeId: string;
    challenge: string;
    expectedFotosPublicKey: string;
}

function openFotosRecoveryPopup(options: OpenFotosRecoveryPopupOptions): Promise<FotosIdResult> {
    const popupUrl = getFotosIdPopupUrl(options.mode, options.displayName);
    const popupOrigin = new URL(popupUrl).origin;
    const requestId = generateRequestId();
    const popupName = `fotos-id-${requestId}`;

    return new Promise((resolve, reject) => {
        const popup = window.open(popupUrl, popupName, 'popup,width=460,height=620');
        if (!popup) {
            reject(new Error('Popup blocked — please allow popups for this site'));
            return;
        }
        const popupWindow = popup;

        let resolved = false;
        let checkClosedTimer: ReturnType<typeof setInterval> | undefined;

        const timeout = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            cleanup();
            try {
                popupWindow.close();
            } catch {}
            reject(new Error('Fotos id popup timed out'));
        }, POPUP_TIMEOUT_MS);

        function cleanup(): void {
            clearTimeout(timeout);
            if (checkClosedTimer !== undefined) clearInterval(checkClosedTimer);
            window.removeEventListener('message', handleMessage);
        }

        function handleMessage(event: MessageEvent): void {
            if (event.source !== popupWindow) return;
            if (event.origin !== popupOrigin) return;

            const data = event.data;
            if (!data) return;

            if (data.type === 'fotos-id-ready') {
                popupWindow.postMessage({
                    type: 'fotos-id-request',
                    requestId,
                    mode: options.mode,
                    displayName: options.displayName,
                    personId: options.personId,
                    personPublicKey: options.personPublicKey,
                    challengeId: options.challengeId,
                    challenge: options.challenge,
                    expectedFotosPublicKey: options.expectedFotosPublicKey,
                }, popupOrigin);
                return;
            }

            if (data.type === 'fotos-id-result' && data.requestId === requestId && !resolved) {
                resolved = true;
                cleanup();
                resolve({
                    success: data.success,
                    data: data.data,
                    error: data.error,
                });
            }
        }

        window.addEventListener('message', handleMessage);
        checkClosedTimer = setInterval(() => {
            if (!popupWindow.closed || resolved) return;
            resolved = true;
            cleanup();
            reject(new Error('Fotos id popup was closed'));
        }, 500);
    });
}

function requireSuccessfulFotosRecoveryResult(result: FotosIdResult): {
    identity: string;
    displayName: string;
    claimPayload: string;
    signature: string;
} {
    if (!result.success) {
        throw new Error(
            typeof result.error === 'string' && result.error.trim().length > 0
                ? result.error
                : 'Fotos id popup returned failure without an error message',
        );
    }

    const data = result.data;
    if (!data) {
        throw new Error('Fotos id popup returned success without data');
    }
    if (data.mode !== 'recover') {
        throw new Error(`Expected fotos recovery result, received ${data.mode}`);
    }

    const identity = data.identity?.trim();
    const displayName = data.displayName?.trim();
    const claimPayload = data.claimPayload?.trim();
    const signature = data.signature?.trim();

    if (!identity) throw new Error('Fotos id popup did not return identity');
    if (!displayName) throw new Error('Fotos id popup did not return displayName');
    if (!claimPayload) throw new Error('Fotos id popup did not return claimPayload');
    if (!signature) throw new Error('Fotos id popup did not return signature');

    return {
        identity,
        displayName,
        claimPayload,
        signature,
    };
}

export interface FotosRecoveryTarget<PersonId extends string = string> {
    personId: PersonId;
    personPublicKeyHex: string;
    instanceEncryptionKeyHex: string;
}

export interface CompletedFotosRecoveryFlow<PersonId extends string = string> {
    personId: PersonId;
    fotosIdentity: string;
    fotosDisplayName: string;
    cert: any;
}

export async function runFotosRecoveryFlow<PersonId extends string = string>({
    requestedDisplayName,
    requestedIdentity,
    getFotosRecoveryTarget,
    signClaimWithGlueKey,
    fetchImpl = fetch,
    apiBase = API_BASE,
}: {
    requestedDisplayName: string;
    requestedIdentity: string;
    getFotosRecoveryTarget: () => Promise<FotosRecoveryTarget<PersonId>>;
    signClaimWithGlueKey: (personId: PersonId, claimPayload: string) => Promise<string>;
    fetchImpl?: typeof fetch;
    apiBase?: string;
}): Promise<CompletedFotosRecoveryFlow<PersonId>> {
    const beginRes = await fetchImpl(`${apiBase}/api/registration/fotos/recover-begin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: requestedIdentity }),
    });
    const beginBody = await readJsonResponse(beginRes);
    if (
        !beginRes.ok
        || !beginBody?.success
        || typeof beginBody?.data?.challengeId !== 'string'
        || typeof beginBody?.data?.challenge !== 'string'
    ) {
        throw new Error(beginBody?.error || `Recovery setup failed: ${beginRes.status}`);
    }
    if (typeof beginBody.data.fotosPublicKey !== 'string' || beginBody.data.fotosPublicKey.trim().length === 0) {
        throw new Error('Recovery setup did not return the expected fotos proof key');
    }

    const { personId, personPublicKeyHex, instanceEncryptionKeyHex } = await getFotosRecoveryTarget();
    const popupResult = await openFotosRecoveryPopup({
        mode: 'recover',
        displayName: requestedDisplayName,
        personId,
        personPublicKey: personPublicKeyHex,
        challengeId: beginBody.data.challengeId,
        challenge: beginBody.data.challenge,
        expectedFotosPublicKey: beginBody.data.fotosPublicKey,
    });
    const {
        identity: fotosIdentity,
        displayName: fotosDisplayName,
        claimPayload,
        signature: fotosSignature,
    } = requireSuccessfulFotosRecoveryResult(popupResult);

    if (fotosIdentity !== requestedIdentity) {
        throw new Error(`Fotos recovery returned ${fotosIdentity}, expected ${requestedIdentity}`);
    }

    const glueSignature = await signClaimWithGlueKey(personId, claimPayload);
    const recoverRes = await fetchImpl(`${apiBase}/api/registration/fotos/recover-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            claimPayload,
            glueSignature,
            fotosSignature,
            instanceEncryptionKey: instanceEncryptionKeyHex,
        }),
    });
    const recoverBody = await readJsonResponse(recoverRes);
    if (!recoverRes.ok || !recoverBody?.success || !recoverBody?.data?.cert) {
        throw new Error(recoverBody?.error || `Fotos recovery failed: ${recoverRes.status}`);
    }

    return {
        personId,
        fotosIdentity,
        fotosDisplayName,
        cert: recoverBody.data.cert,
    };
}

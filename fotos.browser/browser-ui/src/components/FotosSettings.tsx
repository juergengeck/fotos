import { useState, useCallback, useEffect, useRef } from 'react';
import { Shield, ExternalLink, Check, KeyRound, GripVertical, X, Loader2, LogOut, Key } from 'lucide-react';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { FotosModel } from '@/lib/onecore-boot';
import {
    clearPendingAuthenticationContinuation,
    hasPendingAuthenticationContinuation,
    queueAuthenticationContinuation,
} from '@/lib/authFlowState';
import { ensureConfiguredGlueIdentity } from '@/lib/glueIdentity';
import { resolveGlueIdentityState } from '@/lib/glueIdentityState';
import { resolveGlueCertificationState } from '@/lib/glueCertification';
import { classifyGlueFailure, toGlueHandle, type AuthLoginWarning } from '@/lib/authLoginBridge';
import { runFotosRecoveryFlow } from '@/lib/fotosIdRecovery';
import { API_BASE } from '../config.js';

import { ChevronDown } from 'lucide-react';

function CollapsibleSection({ label, defaultOpen = true, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex w-full items-center gap-1 text-[10px] text-white/25 uppercase tracking-wider font-medium hover:text-white/40 transition-colors"
            >
                <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
                {label}
            </button>
            {open && <div className="mt-1.5 space-y-2">{children}</div>}
        </div>
    );
}

type CertState = 'ephemeral' | 'anchored' | 'certified';

interface FotosSettingsProps {
    model: FotosModel | null;
    acceptSharing: boolean;
    onAcceptSharingChange: (enabled: boolean) => void;
}

function setFedCMLoginStatus(status: 'logged-in' | 'logged-out') {
    try {
        if ('login' in navigator) {
            (navigator as any).login.setStatus(status);
        }
    } catch {}
}

function toGlueIdentity(displayName: string | null | undefined): string | null {
    const glueHandle = toGlueHandle(displayName?.trim() ?? '');
    return glueHandle ? `${glueHandle}@glue.one` : null;
}

function isIdentityInputError(message: string): boolean {
    return (
        message.startsWith('Enter ')
        || message.startsWith('Display name')
        || message.startsWith('User ID')
        || message.startsWith('Current identity')
        || message.startsWith('Authentication is still preparing')
    );
}

export function FotosSettings({
    model,
    acceptSharing,
    onAcceptSharingChange,
}: FotosSettingsProps) {
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [draftDisplayName, setDraftDisplayName] = useState('');
    const [publicationIdentity, setPublicationIdentity] = useState<SHA256IdHash<Person> | null>(
        model?.publicationIdentity ?? null,
    );
    const [certState, setCertState] = useState<CertState>('ephemeral');
    const [certValidUntil, setCertValidUntil] = useState<string | null>(null);
    const [passkeyCount, setPasskeyCount] = useState<number | null>(null);
    const [authenticating, setAuthenticating] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [authWarning, setAuthWarning] = useState<AuthLoginWarning | null>(null);
    const [hasRecoveryKey, setHasRecoveryKey] = useState(false);
    const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);
    const [registeringPasskey, setRegisteringPasskey] = useState(false);
    const [recoveringWithFotos, setRecoveringWithFotos] = useState(false);
    const [recoveringWithPrivateKey, setRecoveringWithPrivateKey] = useState(false);
    const [showAuthenticationHint, setShowAuthenticationHint] = useState(() => hasPendingAuthenticationContinuation());
    const [showIdentityEditor, setShowIdentityEditor] = useState(false);
    const requestedDisplayName = draftDisplayName.trim();
    const requestedIdentity = toGlueIdentity(requestedDisplayName);
    const currentDisplayName = displayName?.trim() ?? '';
    const currentIdentity = toGlueIdentity(currentDisplayName);
    const identityReadyForAuthentication = Boolean(publicationIdentity && requestedDisplayName);

    // Load identity state from settings
    useEffect(() => {
        if (!model?.settingsPlan) return;
        let cancelled = false;
        (async () => {
            try {
                const { values } = await model.settingsPlan.getSection({ moduleId: 'glue' });
                const nextSyncEnabled = values.syncEnabled === true;
                const resolvedIdentity = resolveGlueIdentityState(
                    values,
                    model?.publicationIdentity ? String(model.publicationIdentity) : null,
                );
                if (cancelled) return;
                setSyncEnabled(nextSyncEnabled);
                setPublicationIdentity(resolvedIdentity.publicationIdentity as SHA256IdHash<Person> | null);
                setDisplayName(resolvedIdentity.displayName);
                setDraftDisplayName(prev => prev.trim().length > 0 ? prev : (resolvedIdentity.displayName ?? ''));

                if (!nextSyncEnabled || !resolvedIdentity.displayName || !resolvedIdentity.publicationIdentity) {
                    setCertState('ephemeral');
                    setCertValidUntil(null);
                    setPasskeyCount(null);
                    setHasRecoveryKey(false);
                    setFedCMLoginStatus('logged-out');
                    return;
                }

                const certificationState = await resolveGlueCertificationState({
                    publicationIdentity: resolvedIdentity.publicationIdentity as SHA256IdHash<Person>,
                    displayName: resolvedIdentity.displayName,
                });
                if (cancelled) return;

                setCertState(certificationState.certState);
                setCertValidUntil(certificationState.certValidUntil);
                if (certificationState.certState !== 'certified') {
                    setPasskeyCount(null);
                    setHasRecoveryKey(false);
                }

                setFedCMLoginStatus(certificationState.certState === 'certified' ? 'logged-in' : 'logged-out');
                if (certificationState.certState === 'certified') {
                    clearPendingAuthenticationContinuation();
                    setShowAuthenticationHint(false);
                }
            } catch {
                if (cancelled) return;
                setPublicationIdentity(null);
                setCertState('ephemeral');
                setCertValidUntil(null);
                setPasskeyCount(null);
                setFedCMLoginStatus('logged-out');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [model?.settingsPlan, model?.publicationIdentity]);

    useEffect(() => {
        if (certState !== 'certified') return;
        clearPendingAuthenticationContinuation();
        setShowAuthenticationHint(false);
    }, [certState]);

    const refreshPasskeyCount = useCallback(async (
        nextPublicationIdentity: SHA256IdHash<Person>,
        nextDisplayName: string,
    ): Promise<number | null> => {
        try {
            const { signOwnershipProof } = await import('@glueone/glue.core');
            const { identity, publicKey, signature } = await signOwnershipProof(
                nextPublicationIdentity,
                nextDisplayName,
                'passkey-list:{identity}',
            );
            const res = await fetch(`${API_BASE}/api/registration/passkey/list`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: identity, publicKey, signature }),
            });

            if (!res.ok) {
                setPasskeyCount(null);
                return null;
            }

            const result = await res.json();
            if (result.success && result.data?.passkeys) {
                const nextCount = result.data.passkeys.length;
                setPasskeyCount(nextCount);
                return nextCount;
            }
        } catch {
            // passkey count is informational
        }

        setPasskeyCount(null);
        return null;
    }, []);

    const applyCertifiedIdentityState = useCallback(async (
        nextPublicationIdentity: SHA256IdHash<Person>,
        nextDisplayName: string,
        cert?: { validUntil?: unknown } | null,
        options?: { closeIdentityEditor?: boolean },
    ): Promise<void> => {
        setCertState('certified');
        setPublicationIdentity(nextPublicationIdentity);
        setDisplayName(nextDisplayName);
        setDraftDisplayName(nextDisplayName);
        setAuthError(null);
        setAuthWarning(null);
        if (typeof cert?.validUntil === 'string' || typeof cert?.validUntil === 'number') {
            setCertValidUntil(new Date(cert.validUntil).toLocaleDateString());
        } else {
            setCertValidUntil(null);
        }
        setFedCMLoginStatus('logged-in');
        clearPendingAuthenticationContinuation();
        setShowAuthenticationHint(false);
        if (options?.closeIdentityEditor) {
            setShowIdentityEditor(false);
        }
        const nextPasskeyCount = await refreshPasskeyCount(
            nextPublicationIdentity,
            nextDisplayName,
        );
        if (nextPasskeyCount === 0) {
            const dismissed = localStorage.getItem('fotos_passkey_prompt_dismissed');
            if (!dismissed) setShowPasskeyPrompt(true);
            return;
        }
        if (nextPasskeyCount !== null) {
            setShowPasskeyPrompt(false);
        }
    }, [refreshPasskeyCount]);

    const persistDisplayNameChange = useCallback(async (
        nextDisplayName: string,
    ): Promise<string | null> => {
        if (!model?.settingsPlan) {
            return 'Authentication is unavailable right now.';
        }

        try {
            await ensureConfiguredGlueIdentity(
                model.settingsPlan,
                model.leuteModel,
                nextDisplayName,
                model.ownerId,
            );
            return null;
        } catch (error) {
            console.warn('[fotos.one] Failed to persist updated glue display name:', error);
            return error instanceof Error
                ? error.message
                : 'Failed to save the new user ID locally';
        }
    }, [model]);

    // Load passkey count
    useEffect(() => {
        if (certState !== 'certified' || !syncEnabled || !displayName || !publicationIdentity) return;
        (async () => {
            await refreshPasskeyCount(publicationIdentity, displayName);
        })();
    }, [certState, syncEnabled, displayName, publicationIdentity, refreshPasskeyCount]);

    // Check recovery key status
    useEffect(() => {
        if (certState !== 'certified' || !publicationIdentity) return;
        fetch(`${API_BASE}/api/recovery/status/${encodeURIComponent(publicationIdentity)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.hasRecoveryKey) setHasRecoveryKey(true);
            })
            .catch(() => {});
    }, [certState, publicationIdentity]);

    // Authentication happens in two steps:
    // 1. Enable sync so ONE.core can establish the local device identity.
    // 2. Authenticate via the glue.one passkey popup.
    const getFotosRecoveryTarget = useCallback(async (
        personId: SHA256IdHash<Person>,
    ): Promise<{
        personId: SHA256IdHash<Person>;
        personPublicKeyHex: string;
        instanceEncryptionKeyHex: string;
    }> => {
        const { getDefaultKeys } = await import('@refinio/one.core/lib/keychain/keychain.js');
        const { getPublicKeys } = await import('@refinio/one.core/lib/keychain/key-storage-public.js');
        const { getInstanceIdHash } = await import('@refinio/one.core/lib/instance.js');
        const { uint8arrayToHexString } = await import('@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js');

        const personKeysHash = await getDefaultKeys(personId as any);
        const { publicSignKey } = await getPublicKeys(personKeysHash);
        const personPublicKeyHex = uint8arrayToHexString(publicSignKey);

        const instanceIdHash = getInstanceIdHash();
        if (!instanceIdHash) {
            throw new Error('No instance ID');
        }

        const instanceKeysHash = await getDefaultKeys(instanceIdHash);
        const { publicEncryptionKey } = await getPublicKeys(instanceKeysHash);
        const instanceEncryptionKeyHex = uint8arrayToHexString(publicEncryptionKey);

        return {
            personId,
            personPublicKeyHex,
            instanceEncryptionKeyHex,
        };
    }, []);

    const signFotosClaimWithGlueKey = useCallback(async (
        personId: SHA256IdHash<Person>,
        claimPayload: string,
    ): Promise<string> => {
        const { getDefaultSecretKeysAsBase64 } = await import('@refinio/one.core/lib/keychain/keychain.js');
        const { ensureSecretSignKey, sign } = await import('@refinio/one.core/lib/crypto/sign.js');
        const { uint8arrayToHexString } = await import('@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js');
        const { toByteArray: fromBase64 } = await import('base64-js');

        const { secretSignKey } = await getDefaultSecretKeysAsBase64(personId as any);
        const signatureBytes = sign(
            new TextEncoder().encode(claimPayload),
            ensureSecretSignKey(fromBase64(secretSignKey)),
        );
        return uint8arrayToHexString(signatureBytes);
    }, []);

    const prepareAuthenticationIdentity = useCallback(async (
        trimmedDisplayName: string,
    ): Promise<{
        publicationIdentity: SHA256IdHash<Person>;
        requiresReload: boolean;
    }> => {
        if (!model?.settingsPlan) {
            throw new Error('Authentication is unavailable right now.');
        }

        let nextPublicationIdentity = publicationIdentity;
        const needsIdentityPreparation =
            !nextPublicationIdentity
            || trimmedDisplayName !== (displayName?.trim() ?? '');

        if (needsIdentityPreparation) {
            const prepared = await ensureConfiguredGlueIdentity(
                model.settingsPlan,
                model.leuteModel,
                trimmedDisplayName,
                model.ownerId,
            );
            nextPublicationIdentity = prepared.personId;
            setPublicationIdentity(nextPublicationIdentity);
            setDisplayName(trimmedDisplayName);
        }

        if (!nextPublicationIdentity) {
            throw new Error('Authentication is still preparing. Try again in a moment.');
        }

        return {
            publicationIdentity: nextPublicationIdentity,
            requiresReload:
                !syncEnabled
                || !publicationIdentity
                || nextPublicationIdentity !== publicationIdentity,
        };
    }, [
        model,
        publicationIdentity,
        displayName,
        syncEnabled,
    ]);

    const handleAuthenticate = useCallback(async () => {
        if (!model?.settingsPlan) return;
        setAuthenticating(true);
        setAuthError(null);
        setAuthWarning(null);
        let queuedContinuation = false;

        try {
            const trimmedDisplayName = requestedDisplayName || displayName?.trim() || '';
            if (!trimmedDisplayName) {
                throw new Error('Enter the name you want to use before authenticating.');
            }
            const nextRequestedIdentity = toGlueIdentity(trimmedDisplayName);
            if (!nextRequestedIdentity) {
                throw new Error('Display name must contain at least one letter or number.');
            }

            const {
                publicationIdentity: nextPublicationIdentity,
                requiresReload: shouldReload,
            } = await prepareAuthenticationIdentity(trimmedDisplayName);

            if (shouldReload) {
                queueAuthenticationContinuation();
                queuedContinuation = true;
                await model.settingsPlan.updateSection({
                    moduleId: 'glue',
                    values: { syncEnabled: true },
                });
                window.location.reload();
                return;
            }

            // Certification handles both first-time registration and returning users.
            const { certifyViaPopup } = await import('@glueone/auth.core');
            const result = await certifyViaPopup(nextPublicationIdentity, trimmedDisplayName);
            if (result.success) {
                await applyCertifiedIdentityState(
                    nextPublicationIdentity,
                    trimmedDisplayName,
                    result.data?.cert,
                );
            } else {
                const warning = classifyGlueFailure(
                    result.error || 'Authentication failed',
                    toGlueIdentity(trimmedDisplayName) ?? 'yourname@glue.one',
                );
                setAuthWarning(warning);
            }
        } catch (err) {
            if (queuedContinuation) {
                clearPendingAuthenticationContinuation();
                setShowAuthenticationHint(false);
            }
            const message = err instanceof Error ? err.message : 'Authentication failed';
            if (isIdentityInputError(message)) {
                setAuthError(message);
            } else {
                const warning = classifyGlueFailure(
                    err,
                    requestedIdentity ?? 'yourname@glue.one',
                );
                setAuthWarning(warning);
            }
        } finally {
            setAuthenticating(false);
        }
    }, [
        model,
        syncEnabled,
        requestedDisplayName,
        requestedIdentity,
        displayName,
        publicationIdentity,
        prepareAuthenticationIdentity,
        applyCertifiedIdentityState,
    ]);

    const handleRecoverWithFotosProof = useCallback(async () => {
        if (!model?.settingsPlan) return;
        setRecoveringWithFotos(true);
        setAuthError(null);
        let queuedContinuation = false;

        try {
            const trimmedDisplayName = requestedDisplayName || displayName?.trim() || '';
            if (!trimmedDisplayName) {
                throw new Error('Enter the name you want to recover first.');
            }
            const nextRequestedIdentity = toGlueIdentity(trimmedDisplayName);
            if (!nextRequestedIdentity) {
                throw new Error('Display name must contain at least one letter or number.');
            }

            const isAuthenticatedRename =
                syncEnabled
                && Boolean(publicationIdentity)
                && currentDisplayName.length > 0
                && trimmedDisplayName !== currentDisplayName;
            let nextPublicationIdentity: SHA256IdHash<Person>;
            let shouldReload = false;
            if (isAuthenticatedRename && publicationIdentity) {
                nextPublicationIdentity = publicationIdentity;
            } else {
                const prepared = await prepareAuthenticationIdentity(trimmedDisplayName);
                nextPublicationIdentity = prepared.publicationIdentity;
                shouldReload = prepared.requiresReload;
            }

            if (shouldReload) {
                queueAuthenticationContinuation();
                queuedContinuation = true;
                await model.settingsPlan.updateSection({
                    moduleId: 'glue',
                    values: { syncEnabled: true },
                });
                window.location.reload();
                return;
            }

            const result = await runFotosRecoveryFlow({
                requestedDisplayName: trimmedDisplayName,
                requestedIdentity: nextRequestedIdentity,
                getFotosRecoveryTarget: async () => await getFotosRecoveryTarget(nextPublicationIdentity),
                signClaimWithGlueKey: signFotosClaimWithGlueKey,
            });

            let persistenceError: string | null = null;
            if (isAuthenticatedRename) {
                persistenceError = await persistDisplayNameChange(trimmedDisplayName);
            }

            await applyCertifiedIdentityState(
                result.personId,
                trimmedDisplayName,
                result.cert,
                { closeIdentityEditor: isAuthenticatedRename && persistenceError === null },
            );

            if (persistenceError) {
                setAuthError(`User ID recovered, but saving it locally failed: ${persistenceError}`);
            }
        } catch (err) {
            if (queuedContinuation) {
                clearPendingAuthenticationContinuation();
                setShowAuthenticationHint(false);
            }
            setAuthError(err instanceof Error ? err.message : 'Fotos recovery failed');
        } finally {
            setRecoveringWithFotos(false);
        }
    }, [
        model,
        requestedDisplayName,
        displayName,
        currentDisplayName,
        publicationIdentity,
        syncEnabled,
        getFotosRecoveryTarget,
        prepareAuthenticationIdentity,
        signFotosClaimWithGlueKey,
        persistDisplayNameChange,
        applyCertifiedIdentityState,
    ]);

    const handleRecoverWithPrivateKey = useCallback(async () => {
        if (!model?.settingsPlan) return;
        setRecoveringWithPrivateKey(true);
        setAuthError(null);
        setAuthWarning(null);
        let queuedContinuation = false;

        try {
            const trimmedDisplayName = requestedDisplayName || displayName?.trim() || '';
            if (!trimmedDisplayName) {
                throw new Error('Enter the name you want to recover first.');
            }
            const nextRequestedIdentity = toGlueIdentity(trimmedDisplayName);
            if (!nextRequestedIdentity) {
                throw new Error('Display name must contain at least one letter or number.');
            }

            const isAuthenticatedRename =
                syncEnabled
                && Boolean(publicationIdentity)
                && currentDisplayName.length > 0
                && trimmedDisplayName !== currentDisplayName;
            let nextPublicationIdentity: SHA256IdHash<Person>;
            let shouldReload = false;
            if (isAuthenticatedRename && publicationIdentity) {
                nextPublicationIdentity = publicationIdentity;
            } else {
                const prepared = await prepareAuthenticationIdentity(trimmedDisplayName);
                nextPublicationIdentity = prepared.publicationIdentity;
                shouldReload = prepared.requiresReload;
            }

            if (shouldReload) {
                queueAuthenticationContinuation();
                queuedContinuation = true;
                await model.settingsPlan.updateSection({
                    moduleId: 'glue',
                    values: { syncEnabled: true },
                });
                window.location.reload();
                return;
            }

            const { recoverWithPrivateKeyViaPopup } = await import('@glueone/auth.core');
            const result = await recoverWithPrivateKeyViaPopup(
                nextPublicationIdentity,
                trimmedDisplayName,
            );
            if (!result.success) {
                throw new Error(result.error || 'Recovery-key recovery failed');
            }

            let persistenceError: string | null = null;
            if (isAuthenticatedRename) {
                persistenceError = await persistDisplayNameChange(trimmedDisplayName);
            }

            await applyCertifiedIdentityState(
                nextPublicationIdentity,
                trimmedDisplayName,
                result.data?.cert,
                { closeIdentityEditor: isAuthenticatedRename && persistenceError === null },
            );

            if (persistenceError) {
                setAuthError(`User ID recovered, but saving it locally failed: ${persistenceError}`);
            }
        } catch (err) {
            if (queuedContinuation) {
                clearPendingAuthenticationContinuation();
                setShowAuthenticationHint(false);
            }
            setAuthError(err instanceof Error ? err.message : 'Recovery-key recovery failed');
        } finally {
            setRecoveringWithPrivateKey(false);
        }
    }, [
        model,
        requestedDisplayName,
        displayName,
        currentDisplayName,
        publicationIdentity,
        syncEnabled,
        prepareAuthenticationIdentity,
        persistDisplayNameChange,
        applyCertifiedIdentityState,
    ]);

    const handleChangeUserId = useCallback(async () => {
        if (!model?.settingsPlan || !publicationIdentity) return;
        setAuthenticating(true);
        setAuthError(null);
        setAuthWarning(null);

        try {
            const trimmedDisplayName = requestedDisplayName;
            if (!trimmedDisplayName) {
                throw new Error('Enter the new name you want to use.');
            }
            if (!toGlueIdentity(trimmedDisplayName)) {
                throw new Error('User ID must contain at least one letter or number.');
            }
            if (!currentDisplayName) {
                throw new Error('Current identity is not ready yet.');
            }
            if (trimmedDisplayName === currentDisplayName) {
                throw new Error('Enter a different name to change your user ID.');
            }

            const { certifyViaPopup } = await import('@glueone/auth.core');
            const result = await certifyViaPopup(publicationIdentity, trimmedDisplayName);
            if (!result.success) {
                setAuthWarning(classifyGlueFailure(
                    result.error || 'Changing user ID failed',
                    toGlueIdentity(trimmedDisplayName) ?? 'yourname@glue.one',
                ));
                return;
            }

            const persistenceError = await persistDisplayNameChange(trimmedDisplayName);
            await applyCertifiedIdentityState(
                publicationIdentity,
                trimmedDisplayName,
                result.data?.cert,
                { closeIdentityEditor: persistenceError === null },
            );

            if (persistenceError) {
                setAuthError(`User ID changed, but saving it locally failed: ${persistenceError}`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Changing user ID failed';
            if (isIdentityInputError(message)) {
                setAuthError(message);
            } else {
                setAuthWarning(classifyGlueFailure(
                    err,
                    requestedIdentity ?? 'yourname@glue.one',
                ));
            }
        } finally {
            setAuthenticating(false);
        }
    }, [
        model,
        publicationIdentity,
        requestedDisplayName,
        currentDisplayName,
        requestedIdentity,
        persistDisplayNameChange,
        applyCertifiedIdentityState,
    ]);

    // Register a passkey after successful authentication.
    const handleSavePasskey = useCallback(async () => {
        if (!publicationIdentity || !displayName) return;
        setRegisteringPasskey(true);
        try {
            const { registerPasskeyViaPopup } = await import('@glueone/auth.core');
            const result = await registerPasskeyViaPopup(publicationIdentity, displayName);
            if (result.success) {
                setPasskeyCount(prev => prev === null ? 1 : prev + 1);
            }
        } catch { /* user cancelled or error — non-fatal */ }
        setRegisteringPasskey(false);
        setShowPasskeyPrompt(false);
    }, [publicationIdentity, displayName]);

    // Disable sync and reload.
    const handleDisableSync = useCallback(async () => {
        if (!model?.settingsPlan) return;
        try {
            await model.settingsPlan.updateSection({
                moduleId: 'glue',
                values: { syncEnabled: false },
            });
            setFedCMLoginStatus('logged-out');
            clearPendingAuthenticationContinuation();
            setShowAuthenticationHint(false);
            window.location.reload();
        } catch (err) {
            setAuthError((err as Error).message);
        }
    }, [model?.settingsPlan]);

    const openIdentityEditor = useCallback(() => {
        setDraftDisplayName(displayName ?? '');
        setAuthError(null);
        setAuthWarning(null);
        setShowIdentityEditor(true);
    }, [displayName]);

    const cancelIdentityEditor = useCallback(() => {
        setDraftDisplayName(displayName ?? '');
        setAuthError(null);
        setAuthWarning(null);
        setShowIdentityEditor(false);
    }, [displayName]);

    const authenticated = certState === 'certified' && syncEnabled;
    const needsPreparation = !syncEnabled || !identityReadyForAuthentication;
    const missingDisplayName = requestedDisplayName.length === 0 || requestedIdentity === null;
    const authenticationButtonDisabled = authenticating
        || recoveringWithFotos
        || recoveringWithPrivateKey
        || !model?.settingsPlan
        || missingDisplayName;
    const authenticationButtonLabel = authenticating
        ? (needsPreparation ? 'Preparing authentication...' : 'Authenticating...')
        : recoveringWithFotos
            ? 'Opening fotos recovery...'
        : recoveringWithPrivateKey
            ? 'Opening recovery-key flow...'
        : missingDisplayName
            ? 'Enter user ID'
            : needsPreparation
                ? 'Prepare authentication'
                : 'Authenticate';
    const authenticationDescription = missingDisplayName
        ? 'Choose the user ID you want to use for your fotos id and glue.one identity.'
        : needsPreparation
            ? 'Authentication happens in two steps. fotos will prepare your local identity, enable sync on this device, reload, and bring you back here for glue.one certification.'
        : showAuthenticationHint
            ? 'Sync is ready on this device. Authenticate below to finish linking your fotos id.'
            : 'Authenticate to sync your photos across devices and use your identity on other ONE apps.';
    const renameMissingDisplayName = requestedDisplayName.length === 0 || requestedIdentity === null;
    const renameMatchesCurrent = requestedDisplayName === currentDisplayName;
    const renameButtonDisabled = authenticating
        || recoveringWithFotos
        || recoveringWithPrivateKey
        || !model?.settingsPlan
        || renameMissingDisplayName
        || renameMatchesCurrent;
    const renameButtonLabel = authenticating
        ? 'Changing user ID...'
        : recoveringWithPrivateKey
            ? 'Opening recovery-key flow...'
        : renameMissingDisplayName
            ? 'Enter new user ID'
        : renameMatchesCurrent
                ? 'Enter a different user ID'
                : 'Change user ID';
    const renameDescription = renameMissingDisplayName
        ? 'Enter the new name you want to use for this identity.'
        : renameMatchesCurrent
            ? 'Type a different name to certify a new @glue.one handle for this identity.'
            : 'Changing your user ID keeps this local identity and certifies a new @glue.one handle across ONE apps.';
    const sharingToggleDisabled = !syncEnabled || !publicationIdentity;

    return (
        <CollapsibleSection label="fotos id">
            <div className="space-y-2">
                {/* ── Not authenticated yet ── */}
                {!authenticated && (
                    <>
                        <div className="space-y-1">
                            <label className="block px-2.5 text-[10px] text-white/25 uppercase tracking-wider">
                                User ID
                            </label>
                            <input
                                type="text"
                                value={draftDisplayName}
                                onChange={event => setDraftDisplayName(event.target.value)}
                                placeholder="Your name on glue.one"
                                disabled={authenticating || recoveringWithFotos || recoveringWithPrivateKey}
                                className="w-full px-2.5 py-2 bg-white/5 border border-white/10 rounded-md text-[11px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-white/20"
                            />
                            {requestedIdentity && (
                                <div className="px-2.5 text-[10px] text-white/25">
                                    {requestedIdentity}
                                </div>
                            )}
                        </div>

                        <div className="px-2.5 py-2 bg-white/5 rounded-md text-[11px] text-white/40 leading-relaxed">
                            {authenticationDescription}
                        </div>

                        {/* Authentication action */}
                        <button
                            onClick={() => void handleAuthenticate()}
                            disabled={authenticationButtonDisabled}
                            className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-md text-[11px] font-medium transition-colors ${
                                authenticationButtonDisabled
                                    ? 'bg-white/5 text-white/20 cursor-wait'
                                    : 'bg-[#e94560]/80 text-white hover:bg-[#e94560]'
                            }`}
                        >
                            {authenticating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <Shield className="w-3.5 h-3.5" />
                            {authenticationButtonLabel}
                        </button>

                        {needsPreparation && !missingDisplayName && (
                            <div className="px-2.5 text-[10px] text-white/25">
                                fotos will reopen this tab in settings after the reload.
                            </div>
                        )}

                    </>
                )}

                {/* ── Authenticated ── */}
                {authenticated && displayName && (
                    <>
                        {/* Identity card */}
                        <div className="flex items-center gap-2 px-2.5 py-2 bg-white/5 rounded-md text-[11px] text-white/60">
                            <Shield className="w-3.5 h-3.5 text-green-400/70 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{displayName}</div>
                                {currentIdentity && (
                                    <div className="truncate text-[9px] text-white/25">
                                        {currentIdentity}
                                    </div>
                                )}
                            </div>
                            <Check className="w-3 h-3 text-green-400/70 shrink-0" />
                        </div>

                        {/* Status details */}
                        {certValidUntil && (
                            <div className="px-2.5 text-[9px] text-white/20">
                                Valid until {certValidUntil}
                            </div>
                        )}

                        {/* Passkey status */}
                        <div className="flex items-center gap-1 px-2.5 text-[9px] text-white/20">
                            <Key className="w-2.5 h-2.5" />
                            {passkeyCount === null
                                ? 'Checking passkeys...'
                                : passkeyCount > 0
                                ? `${passkeyCount} passkey${passkeyCount !== 1 ? 's' : ''}`
                                : 'No passkeys'}
                            {passkeyCount === 0 && (
                                <button
                                    onClick={() => void handleSavePasskey()}
                                    disabled={registeringPasskey}
                                    className="ml-1 text-[#e94560]/60 hover:text-[#e94560] transition-colors"
                                >
                                    {registeringPasskey ? 'saving...' : 'add passkey'}
                                </button>
                            )}
                        </div>

                        {/* Passkey save prompt (shown after first successful authentication) */}
                        {showPasskeyPrompt && (
                            <div className="px-2.5 py-2 bg-[#e94560]/8 border border-[#e94560]/20 rounded-md space-y-2">
                                <div className="text-[10px] text-white/50">
                                    Save a passkey for faster authentication next time?
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => void handleSavePasskey()}
                                        disabled={registeringPasskey}
                                        className="px-3 py-1 rounded-md text-[10px] font-medium bg-[#e94560]/80 text-white hover:bg-[#e94560] transition-colors"
                                    >
                                        {registeringPasskey ? 'Saving...' : 'Save passkey'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowPasskeyPrompt(false);
                                            try { localStorage.setItem('fotos_passkey_prompt_dismissed', '1'); } catch {}
                                        }}
                                        className="text-[10px] text-white/25 hover:text-white/40 transition-colors"
                                    >
                                        Skip
                                    </button>
                                </div>
                            </div>
                        )}

                        {!showIdentityEditor ? (
                            <button
                                onClick={openIdentityEditor}
                                className="w-full px-2.5 py-2 rounded-md text-[11px] font-medium bg-white/5 text-white/45 hover:text-white/65 hover:bg-white/10 transition-colors"
                            >
                                Change user ID
                            </button>
                        ) : (
                            <div className="space-y-2 px-2.5 py-2 bg-white/5 rounded-md">
                                <div className="space-y-1">
                                    <label className="block text-[10px] text-white/25 uppercase tracking-wider">
                                        New user ID
                                    </label>
                                    <input
                                        type="text"
                                        value={draftDisplayName}
                                        onChange={event => setDraftDisplayName(event.target.value)}
                                        placeholder="Choose a new name on glue.one"
                                        disabled={authenticating || recoveringWithFotos || recoveringWithPrivateKey}
                                        className="w-full px-2.5 py-2 bg-white/5 border border-white/10 rounded-md text-[11px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-white/20"
                                    />
                                    {requestedIdentity && (
                                        <div className="text-[10px] text-white/25">
                                            {requestedIdentity}
                                        </div>
                                    )}
                                </div>

                                <div className="text-[10px] leading-relaxed text-white/35">
                                    {renameDescription}
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => void handleChangeUserId()}
                                        disabled={renameButtonDisabled}
                                        className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${
                                            renameButtonDisabled
                                                ? 'bg-white/5 text-white/20 cursor-wait'
                                                : 'bg-[#e94560]/80 text-white hover:bg-[#e94560]'
                                        }`}
                                    >
                                        {authenticating && <Loader2 className="w-3 h-3 animate-spin" />}
                                        <Shield className="w-3 h-3" />
                                        {renameButtonLabel}
                                    </button>
                                    <button
                                        onClick={cancelIdentityEditor}
                                        disabled={authenticating || recoveringWithFotos || recoveringWithPrivateKey}
                                        className="px-3 py-2 rounded-md text-[10px] font-medium bg-white/5 text-white/35 hover:text-white/55 hover:bg-white/10 transition-colors disabled:opacity-40"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Recovery key status */}
                        <div className="px-2.5 text-[9px] text-white/20">
                            Recovery key: {hasRecoveryKey ? 'configured' : 'not set'}
                        </div>

                        {/* Inline recovery setup when not configured */}
                        {!hasRecoveryKey && (
                            <RecoverySecretSection
                                publicationIdentity={publicationIdentity}
                                onComplete={() => setHasRecoveryKey(true)}
                            />
                        )}

                        {/* When recovery IS configured, allow changing it */}
                        {hasRecoveryKey && (
                            <CollapsibleSection label="Change recovery key" defaultOpen={false}>
                                <RecoverySecretSection
                                    publicationIdentity={publicationIdentity}
                                    onComplete={() => setHasRecoveryKey(true)}
                                />
                            </CollapsibleSection>
                        )}

                        {/* Federation info */}
                        <div className="px-2.5 py-1.5 bg-white/5 rounded-md text-[10px] text-white/30 leading-relaxed">
                            Your identity works across all ONE apps.
                        </div>

                        {/* Footer links */}
                        <div className="flex items-center gap-3 px-2.5">
                            <a
                                href="https://glue.one"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-white/25 hover:text-white/40 transition-colors"
                            >
                                Manage identity <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                            <button
                                onClick={() => void handleDisableSync()}
                                className="flex items-center gap-1 text-[10px] text-white/25 hover:text-red-400/60 transition-colors ml-auto"
                            >
                                <LogOut className="w-2.5 h-2.5" />
                                Disable sync
                            </button>
                        </div>
                    </>
                )}

                {authWarning && (
                    <div className="px-2.5 py-2 bg-amber-500/10 border border-amber-400/20 rounded-md text-[10px] text-amber-100/85 leading-relaxed">
                        <div className="font-medium text-amber-100">{authWarning.title}</div>
                        <div className="mt-1 text-amber-100/75">{authWarning.message}</div>
                        {authWarning.code === 'glue_name_taken' && (
                            <div className="mt-2 space-y-2">
                                <div className="text-amber-100/75">
                                    If this is your identity and you already bound fotos id, finish with the same private recovery factors instead of retrying the passkey popup.
                                </div>
                                <button
                                    onClick={() => void handleRecoverWithFotosProof()}
                                    disabled={recoveringWithFotos || recoveringWithPrivateKey || !model?.settingsPlan || missingDisplayName}
                                    className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${
                                        recoveringWithFotos || recoveringWithPrivateKey || !model?.settingsPlan || missingDisplayName
                                            ? 'bg-white/5 text-white/25 cursor-wait'
                                            : 'bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                                    }`}
                                >
                                    {recoveringWithFotos && <Loader2 className="w-3 h-3 animate-spin" />}
                                    <KeyRound className="w-3 h-3" />
                                    {recoveringWithFotos ? 'Opening fotos recovery...' : 'Recover with fotos proof'}
                                </button>
                                <button
                                    onClick={() => void handleRecoverWithPrivateKey()}
                                    disabled={recoveringWithFotos || recoveringWithPrivateKey || !model?.settingsPlan || missingDisplayName}
                                    className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${
                                        recoveringWithFotos || recoveringWithPrivateKey || !model?.settingsPlan || missingDisplayName
                                            ? 'bg-white/5 text-white/25 cursor-wait'
                                            : 'bg-white/10 text-amber-100 hover:bg-white/15'
                                    }`}
                                >
                                    {recoveringWithPrivateKey && <Loader2 className="w-3 h-3 animate-spin" />}
                                    <Key className="w-3 h-3" />
                                    {recoveringWithPrivateKey ? 'Opening recovery-key flow...' : 'Recover with recovery key'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {authError && (
                    <div className="px-2.5 text-[10px] text-red-400/70">{authError}</div>
                )}

                <label className={`flex items-start gap-2 rounded-md border px-2.5 py-2 ${
                    sharingToggleDisabled
                        ? 'border-white/8 bg-white/[0.03]'
                        : 'border-white/10 bg-white/5'
                }`}>
                    <input
                        type="checkbox"
                        checked={acceptSharing}
                        disabled={sharingToggleDisabled}
                        onChange={event => onAcceptSharingChange(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#e94560]"
                    />
                    <div className="space-y-1">
                        <div className="text-[11px] text-white/72">Accept sharing</div>
                        <p className="text-[10px] leading-relaxed text-white/30">
                            Advertise this fotos identity to your glue contacts while sharing is active so shared photos can connect automatically.
                        </p>
                        {sharingToggleDisabled && (
                            <p className="text-[10px] leading-relaxed text-white/22">
                                Authenticate this fotos id first to allow automatic contact from trusted peers.
                            </p>
                        )}
                    </div>
                </label>

                {/* Learn more — always visible */}
                <a
                    href="https://glue.one/about.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-white/25 hover:text-white/40 transition-colors"
                >
                    Learn more <ExternalLink className="w-2.5 h-2.5" />
                </a>
            </div>
        </CollapsibleSection>
    );
}

// ── Recovery Secret (inline) ────────────────────────────────────────

type RecoveryPhase = 'idle' | 'picking' | 'deriving' | 'submitting' | 'done' | 'error';

interface SelectedImage {
    file: File;
    thumbnailUrl: string;
}

function RecoverySecretSection({
    publicationIdentity,
    onComplete,
}: {
    publicationIdentity: string | null;
    onComplete?: () => void;
}) {
    const [phase, setPhase] = useState<RecoveryPhase>('idle');
    const [images, setImages] = useState<SelectedImage[]>([]);
    const [passphrase, setPassphrase] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragIndexRef = useRef<number | null>(null);

    const handlePickPhotos = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const newImages: SelectedImage[] = [];
        for (const file of files) {
            newImages.push({
                file,
                thumbnailUrl: URL.createObjectURL(file),
            });
        }
        setImages(prev => [...prev, ...newImages]);
        setPhase('picking');
        e.target.value = '';
    }, []);

    const handleRemoveImage = useCallback((index: number) => {
        setImages(prev => {
            const next = [...prev];
            URL.revokeObjectURL(next[index]!.thumbnailUrl);
            next.splice(index, 1);
            return next;
        });
    }, []);

    const handleDragStart = useCallback((index: number) => {
        dragIndexRef.current = index;
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (dragIndexRef.current === null || dragIndexRef.current === index) return;
        setImages(prev => {
            const next = [...prev];
            const [moved] = next.splice(dragIndexRef.current!, 1);
            next.splice(index, 0, moved!);
            dragIndexRef.current = index;
            return next;
        });
    }, []);

    const handleDragEnd = useCallback(() => {
        dragIndexRef.current = null;
    }, []);

    const handleDerive = useCallback(async () => {
        if (images.length === 0) return;
        if (passphrase.trim().length === 0) {
            setError('Enter a passphrase');
            return;
        }

        setPhase('deriving');
        setError(null);
        setProgress('Reading photos...');

        try {
            const imageBytes: Uint8Array[] = [];
            for (const img of images) {
                const buf = await img.file.arrayBuffer();
                imageBytes.push(new Uint8Array(buf));
            }

            setProgress('Deriving key (this takes a few seconds)...');

            const { deriveKeyFromPhotos, signRecoveryRequest } = await import('@/lib/photo-key-derivation.js');
            const result = await deriveKeyFromPhotos({
                images: imageBytes,
                passphrase,
            });

            setPhase('submitting');
            setProgress('Registering recovery key...');

            const personId = publicationIdentity ?? '';
            const body = signRecoveryRequest(result, personId);

            const res = await fetch(`${API_BASE}/api/recovery/recover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const body = await res.text();
                throw new Error(`Recovery registration failed: ${body}`);
            }

            setPhase('done');
            setProgress('');
            onComplete?.();

            // Clean up thumbnails
            for (const img of images) {
                URL.revokeObjectURL(img.thumbnailUrl);
            }
        } catch (err) {
            setPhase('error');
            setError(err instanceof Error ? err.message : 'Key derivation failed');
            setProgress('');
        }
    }, [images, passphrase, publicationIdentity, onComplete]);

    const handleReset = useCallback(() => {
        for (const img of images) {
            URL.revokeObjectURL(img.thumbnailUrl);
        }
        setImages([]);
        setPassphrase('');
        setPhase('idle');
        setError(null);
        setProgress('');
    }, [images]);

    const busy = phase === 'deriving' || phase === 'submitting';

    return (
        <div className="space-y-2">
            <p className="px-2.5 text-[10px] leading-relaxed text-white/30">
                Pick photos you'll remember, arrange them in order, and enter a passphrase.
                The same photos in the same order with the same passphrase derive the same recovery key.
            </p>

            {phase === 'done' ? (
                <>
                    <div className="px-2.5 py-2 bg-green-400/10 rounded-md text-[11px] text-green-400/70">
                        Recovery secret registered.
                    </div>
                    <button
                        onClick={handleReset}
                        className="w-full px-2.5 py-2 rounded-md text-[11px] font-medium bg-white/5 text-white/40 hover:text-white/60 transition-colors"
                    >
                        Set new recovery secret
                    </button>
                </>
            ) : (
                <>
                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleFilesSelected}
                    />

                    {/* Photo thumbnails with drag-to-reorder */}
                    {images.length > 0 && (
                        <div className="space-y-1">
                            {images.map((img, i) => (
                                <div
                                    key={img.thumbnailUrl}
                                    draggable
                                    onDragStart={() => handleDragStart(i)}
                                    onDragOver={e => handleDragOver(e, i)}
                                    onDragEnd={handleDragEnd}
                                    className="flex items-center gap-1.5 px-1.5 py-1 bg-white/5 rounded-md group cursor-grab active:cursor-grabbing"
                                >
                                    <GripVertical className="w-3 h-3 text-white/15 shrink-0" />
                                    <span className="text-[10px] text-white/25 w-4 text-right shrink-0">{i + 1}</span>
                                    <img
                                        src={img.thumbnailUrl}
                                        className="w-8 h-8 rounded object-cover shrink-0"
                                    />
                                    <span className="text-[10px] text-white/40 truncate flex-1">{img.file.name}</span>
                                    <button
                                        onClick={() => handleRemoveImage(i)}
                                        className="p-0.5 text-white/15 hover:text-red-400/70 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Add photos button */}
                    <button
                        onClick={handlePickPhotos}
                        disabled={busy}
                        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[11px] font-medium bg-white/5 text-white/40 hover:text-white/60 hover:bg-white/10 transition-colors disabled:opacity-30"
                    >
                        <KeyRound className="w-3.5 h-3.5" />
                        {images.length === 0 ? 'Pick photos' : 'Add more photos'}
                    </button>

                    {/* Passphrase input */}
                    {images.length > 0 && (
                        <div className="space-y-1">
                            <label className="block text-[10px] text-white/25 px-2.5">
                                Passphrase
                            </label>
                            <input
                                type="password"
                                autoComplete="new-password"
                                placeholder="Enter your passphrase"
                                value={passphrase}
                                onChange={e => setPassphrase(e.target.value)}
                                disabled={busy}
                                className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-md text-[11px] text-white/60 placeholder:text-white/15 focus:outline-none focus:border-white/20"
                            />
                        </div>
                    )}

                    {/* Derive button */}
                    {images.length > 0 && passphrase.trim().length > 0 && (
                        <button
                            onClick={handleDerive}
                            disabled={busy}
                            className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[11px] font-medium transition-colors ${
                                busy
                                    ? 'bg-white/5 text-white/20 cursor-wait'
                                    : 'bg-[#e94560]/80 text-white hover:bg-[#e94560]'
                            }`}
                        >
                            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {busy ? progress : 'Derive recovery key'}
                        </button>
                    )}

                    {error && (
                        <div className="px-2.5 text-[10px] text-red-400/70">{error}</div>
                    )}
                </>
            )}
        </div>
    );
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { Shield, ExternalLink, Check, KeyRound, GripVertical, X, Loader2, LogOut, Key } from 'lucide-react';
import type { FotosModel } from '@/lib/onecore-boot';
import {
    DEFAULT_GLUE_CONNECTION_BINDING_ID,
    getGlueBindingPersonId,
    getGlueIdentityProfile,
    nameToIdentity,
} from '@glueone/glue.core';
import { authenticateWithPasskeyViaPopup, registerPasskeyViaPopup, OneAuth } from '@glueone/auth.core';
import { API_BASE } from '../config.js';
import { deriveKeyFromPhotos, signRecoveryRequest } from '@/lib/photo-key-derivation.js';

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
}

function setFedCMLoginStatus(status: 'logged-in' | 'logged-out') {
    try {
        if ('login' in navigator) {
            (navigator as any).login.setStatus(status);
        }
    } catch {}
}

export function FotosSettings({ model }: FotosSettingsProps) {
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [certState, setCertState] = useState<CertState>('ephemeral');
    const [certValidUntil, setCertValidUntil] = useState<string | null>(null);
    const [passkeyCount, setPasskeyCount] = useState(0);
    const [signingIn, setSigningIn] = useState(false);
    const [signInError, setSignInError] = useState<string | null>(null);
    const [hasRecoveryKey, setHasRecoveryKey] = useState(false);
    const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);
    const [registeringPasskey, setRegisteringPasskey] = useState(false);

    const publicationIdentity = model?.publicationIdentity ?? null;

    // Load identity state from settings
    useEffect(() => {
        if (!model?.settingsPlan) return;
        let cancelled = false;
        (async () => {
            try {
                const { values } = await model.settingsPlan.getSection({ moduleId: 'glue' });
                const nextSyncEnabled = values.syncEnabled === true;
                if (cancelled) return;
                setSyncEnabled(nextSyncEnabled);

                const configuredPublicationIdentity = getGlueBindingPersonId(
                    values,
                    DEFAULT_GLUE_CONNECTION_BINDING_ID,
                );
                const boundProfile = configuredPublicationIdentity
                    ? getGlueIdentityProfile(values, configuredPublicationIdentity)
                    : null;
                const name = typeof boundProfile?.displayName === 'string'
                    ? boundProfile.displayName.trim()
                    : typeof values.glueDisplayName === 'string'
                        ? values.glueDisplayName.trim()
                        : null;
                setDisplayName(name);

                if (!nextSyncEnabled || !name || !configuredPublicationIdentity) {
                    setCertState('ephemeral');
                    setCertValidUntil(null);
                    setFedCMLoginStatus('logged-out');
                    return;
                }

                // Check registration + cert status
                const identity = nameToIdentity(name);
                const res = await fetch(`${API_BASE}/api/registration/check/${encodeURIComponent(identity)}`);
                let nextCertState: CertState = 'ephemeral';
                if (res.ok) {
                    const result = await res.json();
                    const registered = !(result.available ?? true);
                    if (registered) {
                        const certRes = await fetch(`${API_BASE}/api/registration/cert/${encodeURIComponent(name)}`);
                        if (certRes.ok) {
                            const certResult = await certRes.json();
                            if (certResult.success && certResult.data?.cert?.validUntil) {
                                if (cancelled) return;
                                nextCertState = 'certified';
                                setCertState('certified');
                                setCertValidUntil(new Date(certResult.data.cert.validUntil).toLocaleDateString());
                            } else {
                                if (cancelled) return;
                                nextCertState = 'anchored';
                                setCertState('anchored');
                            }
                        } else {
                            if (cancelled) return;
                            nextCertState = 'anchored';
                            setCertState('anchored');
                        }
                    } else {
                        if (cancelled) return;
                        nextCertState = 'anchored';
                        setCertState('anchored');
                    }
                }

                setFedCMLoginStatus(nextCertState === 'certified' ? 'logged-in' : 'logged-out');
            } catch {
                if (cancelled) return;
                setCertState('ephemeral');
                setCertValidUntil(null);
                setFedCMLoginStatus('logged-out');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [model?.settingsPlan, model?.publicationIdentity]);

    // Load passkey count
    useEffect(() => {
        if (certState !== 'certified' || !syncEnabled || !displayName || !publicationIdentity) return;
        (async () => {
            try {
                const { signOwnershipProof } = await import('@glueone/glue.core');
                const { identity, publicKey, signature } = await signOwnershipProof(
                    publicationIdentity, displayName, 'passkey-list:{identity}',
                );
                const res = await fetch(`${API_BASE}/api/registration/passkey/list`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: identity, publicKey, signature }),
                });
                if (res.ok) {
                    const result = await res.json();
                    if (result.success && result.data?.passkeys) {
                        setPasskeyCount(result.data.passkeys.length);
                    }
                }
            } catch { /* passkey count is informational */ }
        })();
    }, [certState, syncEnabled, displayName, publicationIdentity]);

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

    // Sign in: passkey first if available, then OneAuth fallback
    const handleSignIn = useCallback(async () => {
        if (!model?.settingsPlan) return;
        setSigningIn(true);
        setSignInError(null);

        try {
            // Enable sync first if needed
            if (!syncEnabled) {
                await model.settingsPlan.updateSection({
                    moduleId: 'glue',
                    values: { syncEnabled: true },
                });
                window.location.reload();
                return;
            }

            if (!model.publicationIdentity || !displayName) {
                throw new Error('Identity not ready — sync may still be loading');
            }

            let usedPasskey = false;

            // Try passkey first if user has any registered
            if (passkeyCount > 0) {
                try {
                    const result = await authenticateWithPasskeyViaPopup(model.publicationIdentity, displayName);
                    if (result.success) {
                        usedPasskey = true;
                        setCertState('certified');
                        if (result.data?.cert?.validUntil) {
                            setCertValidUntil(new Date(result.data.cert.validUntil).toLocaleDateString());
                        }
                        setFedCMLoginStatus('logged-in');
                    }
                } catch {
                    // Passkey failed — fall through to OneAuth
                }
            }

            // OneAuth fallback (FedCM → popup → redirect)
            if (!usedPasskey) {
                const oneAuth = new OneAuth();
                const result = await oneAuth.login({ popup: true });
                if ('cancelled' in result) {
                    setSigningIn(false);
                    return;
                }
                // OneAuth succeeded — reload to complete certification with the new identity
                window.location.reload();
                return;
            }

            // After passkey sign-in, offer to save a passkey if they don't have one
            // (shouldn't happen since we only use passkey when count > 0, but guard)
        } catch (err) {
            setSignInError((err as Error).message);
        } finally {
            setSigningIn(false);
        }
    }, [model?.settingsPlan, model?.publicationIdentity, syncEnabled, displayName, passkeyCount]);

    // OneAuth-only sign-in (when no passkeys or as explicit action)
    const handleSignInWithONE = useCallback(async () => {
        if (!model?.settingsPlan) return;
        setSigningIn(true);
        setSignInError(null);

        try {
            // Enable sync first if needed
            if (!syncEnabled) {
                await model.settingsPlan.updateSection({
                    moduleId: 'glue',
                    values: { syncEnabled: true },
                });
                window.location.reload();
                return;
            }

            const oneAuth = new OneAuth();
            const result = await oneAuth.login({ popup: true });
            if ('cancelled' in result) {
                setSigningIn(false);
                return;
            }
            // Reload to complete certification
            window.location.reload();
        } catch (err) {
            setSignInError((err as Error).message);
        } finally {
            setSigningIn(false);
        }
    }, [model?.settingsPlan, syncEnabled]);

    // Register a passkey after successful sign-in
    const handleSavePasskey = useCallback(async () => {
        if (!model?.publicationIdentity || !displayName) return;
        setRegisteringPasskey(true);
        try {
            const result = await registerPasskeyViaPopup(model.publicationIdentity, displayName);
            if (result.success) {
                setPasskeyCount(prev => prev + 1);
            }
        } catch { /* user cancelled or error — non-fatal */ }
        setRegisteringPasskey(false);
        setShowPasskeyPrompt(false);
    }, [model?.publicationIdentity, displayName]);

    // Sign out: disable sync and reload
    const handleSignOut = useCallback(async () => {
        if (!model?.settingsPlan) return;
        try {
            await model.settingsPlan.updateSection({
                moduleId: 'glue',
                values: { syncEnabled: false },
            });
            setFedCMLoginStatus('logged-out');
            window.location.reload();
        } catch (err) {
            setSignInError((err as Error).message);
        }
    }, [model?.settingsPlan]);

    const signedIn = certState === 'certified' && syncEnabled;

    return (
        <CollapsibleSection label="fotos id">
            <div className="space-y-2">
                {/* ── Signed out ── */}
                {!signedIn && (
                    <>
                        <div className="px-2.5 py-2 bg-white/5 rounded-md text-[11px] text-white/40 leading-relaxed">
                            Sign in to sync your photos across devices and use your identity on other ONE apps.
                        </div>

                        {/* Primary sign-in button */}
                        <button
                            onClick={passkeyCount > 0 ? handleSignIn : handleSignInWithONE}
                            disabled={signingIn || !model?.settingsPlan}
                            className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-md text-[11px] font-medium transition-colors ${
                                signingIn
                                    ? 'bg-white/5 text-white/20 cursor-wait'
                                    : 'bg-[#e94560]/80 text-white hover:bg-[#e94560]'
                            }`}
                        >
                            {signingIn && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <Shield className="w-3.5 h-3.5" />
                            {signingIn
                                ? 'Signing in...'
                                : passkeyCount > 0
                                    ? 'Sign in'
                                    : 'Sign in with ONE'}
                        </button>

                        {/* If user has passkeys, show OneAuth as secondary option */}
                        {passkeyCount > 0 && !signingIn && (
                            <button
                                onClick={handleSignInWithONE}
                                className="w-full text-center text-[10px] text-white/25 hover:text-white/40 transition-colors py-1"
                            >
                                Sign in with ONE instead
                            </button>
                        )}

                        {signInError && (
                            <div className="px-2.5 text-[10px] text-red-400/70">{signInError}</div>
                        )}
                    </>
                )}

                {/* ── Signed in ── */}
                {signedIn && displayName && (
                    <>
                        {/* Identity card */}
                        <div className="flex items-center gap-2 px-2.5 py-2 bg-white/5 rounded-md text-[11px] text-white/60">
                            <Shield className="w-3.5 h-3.5 text-green-400/70 shrink-0" />
                            <span className="truncate flex-1 font-medium">{displayName}</span>
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
                            {passkeyCount > 0
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

                        {/* Passkey save prompt (shown after OneAuth sign-in) */}
                        {showPasskeyPrompt && (
                            <div className="px-2.5 py-2 bg-[#e94560]/8 border border-[#e94560]/20 rounded-md space-y-2">
                                <div className="text-[10px] text-white/50">
                                    Save a passkey for faster sign-in next time?
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

                        {/* Recovery key status */}
                        <div className="px-2.5 text-[9px] text-white/20">
                            Recovery key: {hasRecoveryKey ? 'configured' : 'not set'}
                        </div>

                        {/* Inline recovery setup when not configured */}
                        {!hasRecoveryKey && (
                            <RecoverySecretSection model={model} onComplete={() => setHasRecoveryKey(true)} />
                        )}

                        {/* When recovery IS configured, allow changing it */}
                        {hasRecoveryKey && (
                            <CollapsibleSection label="Change recovery key" defaultOpen={false}>
                                <RecoverySecretSection model={model} onComplete={() => setHasRecoveryKey(true)} />
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
                                onClick={() => void handleSignOut()}
                                className="flex items-center gap-1 text-[10px] text-white/25 hover:text-red-400/60 transition-colors ml-auto"
                            >
                                <LogOut className="w-2.5 h-2.5" />
                                Sign out
                            </button>
                        </div>
                    </>
                )}

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

function RecoverySecretSection({ model, onComplete }: { model: FotosModel | null; onComplete?: () => void }) {
    const [phase, setPhase] = useState<RecoveryPhase>('idle');
    const [images, setImages] = useState<SelectedImage[]>([]);
    const [pin, setPin] = useState('');
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
        if (!/^\d{8}$/.test(pin)) {
            setError('Enter a date as 8 digits: DDMMYYYY');
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

            const result = await deriveKeyFromPhotos({
                images: imageBytes,
                pin,
            });

            setPhase('submitting');
            setProgress('Registering recovery key...');

            const personId = model?.publicationIdentity ?? '';
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
    }, [images, pin, model, onComplete]);

    const handleReset = useCallback(() => {
        for (const img of images) {
            URL.revokeObjectURL(img.thumbnailUrl);
        }
        setImages([]);
        setPin('');
        setPhase('idle');
        setError(null);
        setProgress('');
    }, [images]);

    const busy = phase === 'deriving' || phase === 'submitting';

    return (
        <div className="space-y-2">
            <p className="px-2.5 text-[10px] leading-relaxed text-white/30">
                Pick photos you'll remember, arrange them in order, and enter a date as PIN.
                This derives a recovery key from your photos.
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

                    {/* PIN input */}
                    {images.length > 0 && (
                        <div className="space-y-1">
                            <label className="block text-[10px] text-white/25 px-2.5">
                                Date PIN (DDMMYYYY)
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={8}
                                placeholder="DDMMYYYY"
                                value={pin}
                                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                disabled={busy}
                                className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-md text-[11px] text-white/60 font-mono placeholder:text-white/15 focus:outline-none focus:border-white/20"
                            />
                        </div>
                    )}

                    {/* Derive button */}
                    {images.length > 0 && pin.length === 8 && (
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

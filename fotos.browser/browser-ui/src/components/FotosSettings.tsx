import { useState, useCallback, useEffect, useRef } from 'react';
import { Shield, Wifi, WifiOff, ExternalLink, Check, KeyRound, GripVertical, X, Loader2 } from 'lucide-react';
import type { FotosModel } from '@/lib/onecore-boot';
import {
    DEFAULT_GLUE_CONNECTION_BINDING_ID,
    getGlueBindingPersonId,
    getGlueIdentityProfile,
    nameToIdentity,
} from '@glueone/glue.core';
import { authenticateWithPasskeyViaPopup } from '@glueone/auth.core';
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

export function FotosSettings({ model }: FotosSettingsProps) {
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [syncPending, setSyncPending] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [certState, setCertState] = useState<CertState>('ephemeral');
    const [certValidUntil, setCertValidUntil] = useState<string | null>(null);
    const [passkeyCount, setPasskeyCount] = useState(0);
    const [certifying, setCertifying] = useState(false);
    const [certifyError, setCertifyError] = useState<string | null>(null);
    const [hasRecoveryKey, setHasRecoveryKey] = useState(false);

    const connected = model?.headlessConnected ?? false;
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
                    // Set FedCM login status for browser
                    try {
                        if ('login' in navigator) {
                            (navigator as any).login.setStatus('logged-out');
                        }
                    } catch {}
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
                        // Check for counter-signed cert
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

                // Set FedCM login status for browser
                try {
                    if ('login' in navigator) {
                        (navigator as any).login.setStatus(
                            nextCertState === 'certified' ? 'logged-in' : 'logged-out'
                        );
                    }
                } catch {}
            } catch {
                if (cancelled) return;
                setCertState('ephemeral');
                setCertValidUntil(null);
                // Set FedCM login status for browser
                try {
                    if ('login' in navigator) {
                        (navigator as any).login.setStatus('logged-out');
                    }
                } catch {}
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

    const handleSyncToggle = useCallback(async () => {
        if (!model?.settingsPlan || syncPending) return;

        const nextSyncEnabled = !syncEnabled;
        const previousSyncEnabled = syncEnabled;

        setSyncEnabled(nextSyncEnabled);
        setSyncPending(true);
        setSyncError(null);

        try {
            await model.settingsPlan.updateSection({
                moduleId: 'glue',
                values: {
                    syncEnabled: nextSyncEnabled,
                },
            });
            window.location.reload();
        } catch (err) {
            setSyncEnabled(previousSyncEnabled);
            setSyncPending(false);
            setSyncError(err instanceof Error ? err.message : 'Failed to update sync setting');
        }
    }, [model?.settingsPlan, syncEnabled, syncPending]);

    const handleCertify = useCallback(async () => {
        if (!syncEnabled || !model?.publicationIdentity || !displayName) return;
        setCertifying(true);
        setCertifyError(null);
        try {
            const result = await authenticateWithPasskeyViaPopup(model.publicationIdentity, displayName);
            if (result.success) {
                setCertState('certified');
                if (result.data?.cert?.validUntil) {
                    setCertValidUntil(new Date(result.data.cert.validUntil).toLocaleDateString());
                }
            } else {
                setCertifyError(result.error || 'Certification failed');
            }
        } catch (err) {
            setCertifyError((err as Error).message);
        } finally {
            setCertifying(false);
        }
    }, [syncEnabled, model?.publicationIdentity, displayName]);

    return (
        <>
            {/* Connection status */}
            <CollapsibleSection label="Sync">
                <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
                    <input
                        type="checkbox"
                        checked={syncEnabled}
                        onChange={() => void handleSyncToggle()}
                        disabled={syncPending || !model?.settingsPlan}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#e94560]"
                    />
                    <div className="space-y-1">
                        <div className="text-[11px] text-white/72">Enable glue.one sync</div>
                        <p className="text-[10px] leading-relaxed text-white/30">
                            When off, fotos stays local and does not connect to glue.one.
                        </p>
                    </div>
                </label>

                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/5 rounded-md text-[11px]">
                    {syncPending ? (
                        <>
                            <Wifi className="w-3 h-3 text-white/25" />
                            <span className="text-white/40">Reloading...</span>
                        </>
                    ) : syncEnabled && connected ? (
                        <>
                            <Wifi className="w-3 h-3 text-green-400/70" />
                            <span className="text-green-400/70">Connected to glue.one</span>
                        </>
                    ) : syncEnabled ? (
                        <>
                            <Wifi className="w-3 h-3 text-white/40" />
                            <span className="text-white/40">
                                {publicationIdentity ? 'Sync enabled' : 'Sync enabled, waiting for identity'}
                            </span>
                        </>
                    ) : (
                        <>
                            <WifiOff className="w-3 h-3 text-white/25" />
                            <span className="text-white/25">Sync is off</span>
                        </>
                    )}
                </div>

                {syncError && (
                    <div className="px-2.5 text-[10px] text-red-400/70">{syncError}</div>
                )}
            </CollapsibleSection>

            {/* Identity */}
            <CollapsibleSection label="Identity">
              <div className="space-y-1.5">
                {!syncEnabled && (
                    <div className="px-2.5 py-2 bg-white/5 rounded-md text-[11px] text-white/40 leading-relaxed">
                        {displayName && publicationIdentity
                            ? `${displayName} stays local until Sync is enabled.`
                            : 'Sync is off. Fotos stays local and does not talk to glue.one.'}
                    </div>
                )}

                {syncEnabled && certState === 'ephemeral' && (
                    <div className="px-2.5 py-2 bg-white/5 rounded-md text-[11px] text-white/40 leading-relaxed">
                        Using local identity (ephemeral).
                        Your photos stay on your devices.
                    </div>
                )}

                {certState === 'anchored' && displayName && (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/5 rounded-md text-[11px] text-white/60">
                        <Shield className="w-3 h-3 text-white/30 shrink-0" />
                        <span className="truncate flex-1">{displayName}</span>
                        <span className="text-[9px] text-white/25">self-signed</span>
                    </div>
                )}

                {certState === 'certified' && displayName && (
                    <>
                        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/5 rounded-md text-[11px] text-white/60">
                            <Shield className="w-3 h-3 text-green-400/70 shrink-0" />
                            <span className="truncate flex-1">{displayName}</span>
                            <Check className="w-3 h-3 text-green-400/70 shrink-0" />
                            <span className="text-[9px] text-green-400/50">Certified</span>
                        </div>
                        {certValidUntil && (
                            <div className="px-2.5 text-[9px] text-white/20">
                                Valid until {certValidUntil}
                            </div>
                        )}
                        <div className="px-2.5 text-[9px] text-white/20">
                            {passkeyCount} passkey{passkeyCount !== 1 ? 's' : ''} registered
                        </div>
                        <div className="px-2.5 text-[9px] text-white/20">
                            Recovery key: {hasRecoveryKey ? 'configured' : 'not set'}
                        </div>
                    </>
                )}

                {/* Sign in button — shown when not certified */}
                {syncEnabled && certState !== 'certified' && (
                    <button
                        onClick={handleCertify}
                        disabled={certifying || !displayName || !model?.publicationIdentity}
                        className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[11px] font-medium transition-colors ${
                            certifying
                                ? 'bg-white/5 text-white/20 cursor-wait'
                                : !displayName || !model?.publicationIdentity
                                    ? 'bg-white/5 text-white/20 cursor-not-allowed'
                                : 'bg-[#e94560]/80 text-white hover:bg-[#e94560]'
                        }`}
                    >
                        <Shield className="w-3.5 h-3.5" />
                        {certifying ? 'Certifying...' : 'Sign in with glue.one'}
                    </button>
                )}

                {certifyError && (
                    <div className="px-2.5 text-[10px] text-red-400/70">{certifyError}</div>
                )}

                {/* Manage link — shown when certified */}
                {syncEnabled && certState === 'certified' && (
                    <a
                        href="https://glue.one"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-white/25 hover:text-white/40 transition-colors"
                    >
                        Manage on glue.one <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                )}

                {syncEnabled && certState === 'certified' && (
                    <div className="px-2.5 py-1.5 bg-white/5 rounded-md text-[10px] text-white/30 leading-relaxed">
                        Your identity works across all ONE apps.
                        Other sites can verify you via <span className="text-white/50">Sign in with ONE</span>.
                    </div>
                )}

                {/* Learn more — always visible */}
                <a
                    href="https://glue.one/about.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-white/25 hover:text-white/40 transition-colors"
                >
                    Learn more about glue.one <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </CollapsibleSection>

            {/* Recovery Secret */}
            <RecoverySecretSection model={model} />
        </>
    );
}

type RecoveryPhase = 'idle' | 'picking' | 'deriving' | 'submitting' | 'done' | 'error';

interface SelectedImage {
    file: File;
    thumbnailUrl: string;
}

function RecoverySecretSection({ model }: { model: FotosModel | null }) {
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

            // Clean up thumbnails
            for (const img of images) {
                URL.revokeObjectURL(img.thumbnailUrl);
            }
        } catch (err) {
            setPhase('error');
            setError(err instanceof Error ? err.message : 'Key derivation failed');
            setProgress('');
        }
    }, [images, pin, model]);

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
        <CollapsibleSection label="Recovery" defaultOpen={false}>
            <div className="space-y-2">
                <p className="px-2.5 text-[10px] leading-relaxed text-white/30">
                    Pick photos you'll remember, arrange them in order, and enter a date as PIN.
                    This derives a recovery key from your photos — nothing is stored.
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
        </CollapsibleSection>
    );
}

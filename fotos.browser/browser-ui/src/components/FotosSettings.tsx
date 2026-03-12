import { useState, useCallback, useEffect } from 'react';
import { Shield, Wifi, WifiOff, ExternalLink, Check } from 'lucide-react';
import type { FotosModel } from '@/lib/onecore-boot';
import { nameToIdentity } from '@glueone/glue.core';
import { authenticateWithPasskeyViaPopup } from '@glueone/auth.core';
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
}

export function FotosSettings({ model }: FotosSettingsProps) {
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [certState, setCertState] = useState<CertState>('ephemeral');
    const [certValidUntil, setCertValidUntil] = useState<string | null>(null);
    const [passkeyCount, setPasskeyCount] = useState(0);
    const [certifying, setCertifying] = useState(false);
    const [certifyError, setCertifyError] = useState<string | null>(null);

    const connected = model?.headlessConnected ?? false;
    const publicationIdentity = model?.publicationIdentity ?? null;

    // Load identity state from settings
    useEffect(() => {
        if (!model?.settingsPlan) return;
        (async () => {
            try {
                const { values } = await model.settingsPlan.getSection({ moduleId: 'glue' });
                const name = typeof values.glueDisplayName === 'string' ? values.glueDisplayName.trim() : null;
                setDisplayName(name);

                if (!name) {
                    setCertState('ephemeral');
                    return;
                }

                // Check registration + cert status
                const identity = nameToIdentity(name);
                const res = await fetch(`${API_BASE}/api/registration/check/${encodeURIComponent(identity)}`);
                if (res.ok) {
                    const result = await res.json();
                    const registered = !(result.available ?? true);
                    if (registered) {
                        // Check for counter-signed cert
                        const certRes = await fetch(`${API_BASE}/api/registration/cert/${encodeURIComponent(name)}`);
                        if (certRes.ok) {
                            const certResult = await certRes.json();
                            if (certResult.success && certResult.data?.cert?.validUntil) {
                                setCertState('certified');
                                setCertValidUntil(new Date(certResult.data.cert.validUntil).toLocaleDateString());
                            } else {
                                setCertState('anchored');
                            }
                        } else {
                            setCertState('anchored');
                        }
                    } else {
                        setCertState('anchored');
                    }
                }
            } catch {
                setCertState('ephemeral');
            }
        })();
    }, [model?.settingsPlan]);

    // Load passkey count
    useEffect(() => {
        if (certState !== 'certified' || !displayName || !publicationIdentity) return;
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
    }, [certState, displayName, publicationIdentity]);

    const handleCertify = useCallback(async () => {
        if (!model?.publicationIdentity || !displayName) return;
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
    }, [model?.publicationIdentity, displayName]);

    return (
        <>
            {/* Connection status */}
            <CollapsibleSection label="Sync">
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/5 rounded-md text-[11px]">
                    {connected ? (
                        <>
                            <Wifi className="w-3 h-3 text-green-400/70" />
                            <span className="text-green-400/70">Connected to glue.one</span>
                        </>
                    ) : (
                        <>
                            <WifiOff className="w-3 h-3 text-white/25" />
                            <span className="text-white/25">Not connected</span>
                        </>
                    )}
                </div>
            </CollapsibleSection>

            {/* Identity */}
            <CollapsibleSection label="Identity">
              <div className="space-y-1.5">
                {certState === 'ephemeral' && (
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
                    </>
                )}

                {/* Sign in button — shown when not certified */}
                {certState !== 'certified' && (
                    <button
                        onClick={handleCertify}
                        disabled={certifying || !displayName}
                        className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[11px] font-medium transition-colors ${
                            certifying
                                ? 'bg-white/5 text-white/20 cursor-wait'
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
                {certState === 'certified' && (
                    <a
                        href="https://glue.one"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-white/25 hover:text-white/40 transition-colors"
                    >
                        Manage on glue.one <ExternalLink className="w-2.5 h-2.5" />
                    </a>
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
        </>
    );
}

import { nameToIdentity } from '@glueone/glue.core';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { useId, useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export interface SharePeerOption {
    personId: string;
    displayName: string | null;
    glueIdentity?: string | null;
    online: boolean;
    hasVerifiedIdentity: boolean;
    persistent?: boolean;
}

interface ShareWithFieldProps {
    value: string[];
    peers: SharePeerOption[];
    onChange: (nextValue: string[]) => Promise<void> | void;
    placeholder?: string;
    emptyLabel?: string;
}

function normalizeToken(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizePeerDisplayName(peer: SharePeerOption): string | null {
    const trimmed = peer.displayName?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeExplicitGlueIdentity(token: string): string | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    const normalizedHandleInput = normalized.replace(/^@+/, '');
    if (!normalizedHandleInput) {
        return null;
    }

    return normalizedHandleInput.includes('@')
        ? normalizedHandleInput
        : `${normalizedHandleInput}@glue.one`;
}

function normalizeBareGlueIdentity(token: string): string | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized || normalized.includes(' ') || /^[0-9a-f]{16,}$/i.test(normalized)) {
        return null;
    }

    return normalizeExplicitGlueIdentity(normalized);
}

export function resolveGlueIdentityForPeer(peer: SharePeerOption): string | null {
    const explicitIdentity = peer.glueIdentity?.trim().toLowerCase();
    if (explicitIdentity) {
        return explicitIdentity;
    }

    const displayName = normalizePeerDisplayName(peer);
    return displayName ? nameToIdentity(displayName).toLowerCase() : null;
}

function resolveUniquePeerMatch(
    peers: SharePeerOption[],
    matcher: (peer: SharePeerOption) => boolean,
): string | null {
    const matches = peers.filter(matcher);
    return matches.length === 1 ? matches[0]!.personId : null;
}

export async function resolveTokenToPersonId(
    token: string,
    peers: SharePeerOption[],
): Promise<string | null> {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    const contactPeers = peers.filter(peer => peer.persistent);
    const explicitHandle = normalized.startsWith('@') || normalized.includes('@');
    const normalizedHandleIdentity = normalizeExplicitGlueIdentity(token) ?? '';
    const normalizedHandleInput = normalized.replace(/^@+/, '');
    const normalizedHandleLocalPart = normalizedHandleIdentity.endsWith('@glue.one')
        ? normalizedHandleIdentity.slice(0, -'@glue.one'.length)
        : normalizedHandleInput;

    const exactPersonIdMatch = resolveUniquePeerMatch(
        peers,
        peer => peer.personId.toLowerCase() === normalized,
    );
    if (exactPersonIdMatch) {
        return exactPersonIdMatch;
    }

    if (!explicitHandle) {
        const exactContactNameMatch = resolveUniquePeerMatch(
            contactPeers,
            peer => normalizePeerDisplayName(peer)?.toLowerCase() === normalized,
        );
        if (exactContactNameMatch) {
            return exactContactNameMatch;
        }

        const exactContactIdentityLocalPartMatch = resolveUniquePeerMatch(
            contactPeers,
            peer => {
                const identity = resolveGlueIdentityForPeer(peer);
                return identity?.slice(0, identity.indexOf('@')) === normalized;
            },
        );
        if (exactContactIdentityLocalPartMatch) {
            return exactContactIdentityLocalPartMatch;
        }

        const prefixContactNameMatch = resolveUniquePeerMatch(
            contactPeers,
            peer => normalizePeerDisplayName(peer)?.toLowerCase().startsWith(normalized) ?? false,
        );
        if (prefixContactNameMatch) {
            return prefixContactNameMatch;
        }

        const prefixContactIdentityLocalPartMatch = resolveUniquePeerMatch(
            contactPeers,
            peer => {
                const identity = resolveGlueIdentityForPeer(peer);
                const localPart = identity ? identity.slice(0, identity.indexOf('@')) : null;
                return localPart?.startsWith(normalized) ?? false;
            },
        );
        if (prefixContactIdentityLocalPartMatch) {
            return prefixContactIdentityLocalPartMatch;
        }
    }

    const exactNameMatch = resolveUniquePeerMatch(
        peers,
        peer => normalizePeerDisplayName(peer)?.toLowerCase() === normalized,
    );
    if (exactNameMatch) {
        return exactNameMatch;
    }

    const prefixNameMatch = resolveUniquePeerMatch(
        peers,
        peer => normalizePeerDisplayName(peer)?.toLowerCase().startsWith(normalized) ?? false,
    );
    if (prefixNameMatch) {
        return prefixNameMatch;
    }

    if (explicitHandle && normalizedHandleIdentity) {
        const exactIdentityMatch = resolveUniquePeerMatch(
            peers,
            peer => resolveGlueIdentityForPeer(peer) === normalizedHandleIdentity,
        );
        if (exactIdentityMatch) {
            return exactIdentityMatch;
        }

        const exactIdentityLocalPartMatch = resolveUniquePeerMatch(
            peers,
            peer => {
                const identity = resolveGlueIdentityForPeer(peer);
                return identity?.slice(0, identity.indexOf('@')) === normalizedHandleLocalPart;
            },
        );
        if (exactIdentityLocalPartMatch) {
            return exactIdentityLocalPartMatch;
        }

        const prefixIdentityMatch = resolveUniquePeerMatch(
            peers,
            peer => resolveGlueIdentityForPeer(peer)?.startsWith(normalizedHandleIdentity) ?? false,
        );
        if (prefixIdentityMatch) {
            return prefixIdentityMatch;
        }

        const prefixIdentityLocalPartMatch = resolveUniquePeerMatch(
            peers,
            peer => {
                const identity = resolveGlueIdentityForPeer(peer);
                const localPart = identity ? identity.slice(0, identity.indexOf('@')) : null;
                return localPart?.startsWith(normalizedHandleLocalPart) ?? false;
            },
        );
        if (prefixIdentityLocalPartMatch) {
            return prefixIdentityLocalPartMatch;
        }
    }

    if (/^[0-9a-f]{16,}$/i.test(token.trim())) {
        const prefixIdMatch = resolveUniquePeerMatch(
            peers,
            peer => peer.personId.toLowerCase().startsWith(normalized),
        );
        if (prefixIdMatch) {
            return prefixIdMatch;
        }

        return token.trim();
    }

    if (explicitHandle && normalizedHandleIdentity) {
        return String(await calculateIdHashOfObj({
            $type$: 'Person',
            email: normalizedHandleIdentity,
        } as const));
    }

    const normalizedBareIdentity = normalizeBareGlueIdentity(token);
    if (normalizedBareIdentity) {
        return String(await calculateIdHashOfObj({
            $type$: 'Person',
            email: normalizedBareIdentity,
        } as const));
    }

    return null;
}

export function ShareWithField({
    value,
    peers,
    onChange,
    placeholder = 'Add glue contact, name, @identity, or person id',
    emptyLabel = 'Nobody selected yet',
}: ShareWithFieldProps) {
    const datalistId = useId();
    const contactTagsId = useId();
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [manualLabels, setManualLabels] = useState<Record<string, string>>({});
    const [contactTagsOpen, setContactTagsOpen] = useState(false);
    const unselectedPeers = useMemo(
        () => peers.filter(peer => !value.includes(peer.personId)),
        [peers, value],
    );
    const suggestedPeers = useMemo(
        () => unselectedPeers.slice(0, 8),
        [unselectedPeers],
    );

    const resolveSelectedPeerLabel = (personId: string): string => {
        const match = peers.find(peer => peer.personId === personId);
        if (match?.displayName) {
            return match.displayName;
        }

        if (match?.glueIdentity) {
            return match.glueIdentity;
        }

        const manualLabel = manualLabels[personId]?.trim();
        if (manualLabel) {
            return manualLabel;
        }

        return personId.length > 16 ? `${personId.slice(0, 12)}…` : personId;
    };

    const applyChange = async (nextValue: string[]) => {
        setSaving(true);
        try {
            await onChange(nextValue);
        } finally {
            setSaving(false);
        }
    };

    const commitDraft = async () => {
        const token = normalizeToken(draft);
        if (!token) {
            setErrorMessage(null);
            setDraft('');
            return;
        }

        const personId = await resolveTokenToPersonId(token, peers);
        if (!personId) {
            setErrorMessage('No matching glue identity or person id found.');
            return;
        }

        if (value.includes(personId)) {
            setErrorMessage('This identity is already selected.');
            return;
        }

        const manualIdentityLabel = normalizeExplicitGlueIdentity(token);
        if (manualIdentityLabel && !peers.some(peer => peer.personId === personId)) {
            setManualLabels(current => ({
                ...current,
                [personId]: manualIdentityLabel,
            }));
        }

        setErrorMessage(null);
        setDraft('');
        await applyChange([...value, personId]);
    };

    const contactTagsToggleLabel = suggestedPeers.length === unselectedPeers.length
        ? `Show ${suggestedPeers.length} contact tag${suggestedPeers.length === 1 ? '' : 's'}`
        : `Show ${suggestedPeers.length} of ${unselectedPeers.length} contact tags`;

    return (
        <div className="space-y-2">
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-2">
                {value.length === 0 ? (
                    <span className="text-[10px] text-white/25">{emptyLabel}</span>
                ) : (
                    value.map(personId => (
                        <span
                            key={personId}
                            className="inline-flex items-center gap-1 rounded-full border border-[#e94560]/25 bg-[#e94560]/10 px-2 py-0.5 text-[10px] text-[#ffb5c3]"
                        >
                            <span>{resolveSelectedPeerLabel(personId)}</span>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                    void applyChange(value.filter(entry => entry !== personId));
                                }}
                                className="text-[#ffb5c3]/75 transition-colors hover:text-white"
                                aria-label={`Remove ${personId}`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))
                )}
            </div>

            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={draft}
                    list={datalistId}
                    disabled={saving}
                    placeholder={placeholder}
                    onChange={event => {
                        setDraft(event.target.value);
                        if (errorMessage) {
                            setErrorMessage(null);
                        }
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ',') {
                            event.preventDefault();
                            void commitDraft();
                        }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/68 placeholder:text-white/20 focus:border-white/20 focus:outline-none"
                />
                <button
                    type="button"
                    disabled={saving || !normalizeToken(draft)}
                    onClick={() => {
                        void commitDraft();
                    }}
                    className={`rounded-md border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] transition-colors ${
                        saving || !normalizeToken(draft)
                            ? 'border-white/10 bg-white/5 text-white/20 cursor-not-allowed'
                            : 'border-[#e94560]/25 bg-[#e94560]/10 text-[#ff9db0] hover:bg-[#e94560]/16'
                    }`}
                >
                    Add
                </button>
                <datalist id={datalistId}>
                    {peers.map(peer => (
                        <option
                            key={peer.personId}
                            value={peer.glueIdentity ?? peer.displayName ?? peer.personId}
                            label={peer.personId}
                        />
                    ))}
                </datalist>
            </div>

            {errorMessage && (
                <div className="text-[10px] text-[#ff9db0]/80">
                    {errorMessage}
                </div>
            )}

            {unselectedPeers.length > 0 && (
                <div className="space-y-1.5">
                    <button
                        type="button"
                        onClick={() => setContactTagsOpen(open => !open)}
                        aria-expanded={contactTagsOpen}
                        aria-controls={contactTagsId}
                        className="flex items-center gap-1 text-[10px] text-white/28 transition-colors hover:text-white/48"
                    >
                        <ChevronDown className={`h-3 w-3 transition-transform ${contactTagsOpen ? '' : '-rotate-90'}`} />
                        <span>{contactTagsOpen ? 'Hide contact tags' : contactTagsToggleLabel}</span>
                    </button>

                    {contactTagsOpen && (
                        <div id={contactTagsId} className="flex flex-wrap gap-1">
                            {suggestedPeers.map(peer => (
                                <button
                                    key={peer.personId}
                                    type="button"
                                    disabled={saving}
                                    onClick={() => {
                                        void applyChange([...value, peer.personId]);
                                    }}
                                    className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                                        peer.online
                                            ? 'border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/68'
                                            : 'border-white/8 bg-black/20 text-white/25 hover:text-white/45'
                                    }`}
                                >
                                    {peer.displayName ?? `${peer.personId.slice(0, 12)}…`}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

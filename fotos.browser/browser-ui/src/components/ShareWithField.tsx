import { nameToIdentity } from '@glueone/glue.core';
import { useMemo, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { API_BASE } from '@/config';

const MIN_PERSON_ID_PREFIX_LENGTH = 8;
const MIN_DIRECT_PERSON_ID_LENGTH = 16;

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

interface ResolveTokenOptions {
    fetchImpl?: typeof fetch;
    apiBase?: string;
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
    if (!normalized || /\s/.test(normalized)) {
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

export function resolveGlueIdentityForPeer(peer: SharePeerOption): string | null {
    const explicitIdentity = peer.glueIdentity?.trim().toLowerCase();
    if (explicitIdentity) {
        return explicitIdentity;
    }

    const displayName = normalizePeerDisplayName(peer);
    return displayName ? nameToIdentity(displayName).toLowerCase() : null;
}

function scorePeerResolutionPreference(peer: SharePeerOption): number {
    return (
        (peer.online ? 4 : 0)
        + (peer.hasVerifiedIdentity ? 2 : 0)
        + (!peer.persistent ? 1 : 0)
    );
}

function resolvePreferredPeerMatch(
    peers: SharePeerOption[],
    matcher: (peer: SharePeerOption) => boolean,
): string | null {
    const matches = peers.filter(matcher);
    if (matches.length === 0) {
        return null;
    }

    if (matches.length === 1) {
        return matches[0]!.personId;
    }

    let bestMatch: SharePeerOption | null = null;
    let bestScore = -1;
    let bestScoreCount = 0;

    for (const peer of matches) {
        const score = scorePeerResolutionPreference(peer);
        if (score > bestScore) {
            bestMatch = peer;
            bestScore = score;
            bestScoreCount = 1;
            continue;
        }

        if (score === bestScore) {
            bestScoreCount += 1;
        }
    }

    return bestScoreCount === 1 ? bestMatch?.personId ?? null : null;
}

function readCert(payload: any): Record<string, unknown> | null {
    if (payload?.data?.cert && typeof payload.data.cert === 'object') {
        return payload.data.cert as Record<string, unknown>;
    }

    if (payload?.cert && typeof payload.cert === 'object') {
        return payload.cert as Record<string, unknown>;
    }

    return null;
}

async function resolveRegisteredPersonId(
    token: string,
    {
        fetchImpl = fetch,
        apiBase = API_BASE,
    }: ResolveTokenOptions = {},
): Promise<string | null> {
    const normalized = token.trim().toLowerCase();
    if (!normalized || /^[0-9a-f]+$/i.test(normalized)) {
        return null;
    }

    const explicitIdentity = normalizeExplicitGlueIdentity(token);
    const lookupIdentity = explicitIdentity ?? nameToIdentity(token).toLowerCase();
    if (!lookupIdentity) {
        return null;
    }

    const normalizedApiBase = apiBase.replace(/\/+$/, '');
    const registrationApiBase = normalizedApiBase.endsWith('/api')
        ? normalizedApiBase
        : `${normalizedApiBase}/api`;

    let response: Response;
    try {
        response = await fetchImpl(
            `${registrationApiBase}/registration/cert/${encodeURIComponent(lookupIdentity)}`,
        );
    } catch {
        return null;
    }

    if (response.status === 404 || !response.ok) {
        return null;
    }

    const payload = await response.json().catch(() => null);
    if (payload?.success === false) {
        return null;
    }

    const cert = readCert(payload);
    const subject = typeof cert?.subject === 'string' ? cert.subject.trim() : '';
    return subject || null;
}

export async function resolveTokenToPersonId(
    token: string,
    peers: SharePeerOption[],
    options: ResolveTokenOptions = {},
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
    const isHexIdInput = /^[0-9a-f]+$/i.test(normalized);
    const derivedNameIdentity = !explicitHandle && !isHexIdInput
        ? nameToIdentity(token).toLowerCase()
        : null;

    const exactPersonIdMatch = resolvePreferredPeerMatch(
        peers,
        peer => peer.personId.toLowerCase() === normalized,
    );
    if (exactPersonIdMatch) {
        return exactPersonIdMatch;
    }

    if (isHexIdInput && normalized.length >= MIN_PERSON_ID_PREFIX_LENGTH) {
        const prefixIdMatch = resolvePreferredPeerMatch(
            peers,
            peer => peer.personId.toLowerCase().startsWith(normalized),
        );
        if (prefixIdMatch) {
            return prefixIdMatch;
        }
    }

    const exactNameMatch = resolvePreferredPeerMatch(
        peers,
        peer => normalizePeerDisplayName(peer)?.toLowerCase() === normalized,
    );
    if (exactNameMatch) {
        return exactNameMatch;
    }

    if (derivedNameIdentity) {
        const exactDerivedIdentityMatch = resolvePreferredPeerMatch(
            peers,
            peer => resolveGlueIdentityForPeer(peer) === derivedNameIdentity,
        );
        if (exactDerivedIdentityMatch) {
            return exactDerivedIdentityMatch;
        }
    }

    if (!explicitHandle) {
        const exactContactNameMatch = resolvePreferredPeerMatch(
            contactPeers,
            peer => normalizePeerDisplayName(peer)?.toLowerCase() === normalized,
        );
        if (exactContactNameMatch) {
            return exactContactNameMatch;
        }

        const exactContactIdentityLocalPartMatch = resolvePreferredPeerMatch(
            contactPeers,
            peer => {
                const identity = resolveGlueIdentityForPeer(peer);
                return identity?.slice(0, identity.indexOf('@')) === normalized;
            },
        );
        if (exactContactIdentityLocalPartMatch) {
            return exactContactIdentityLocalPartMatch;
        }

        const prefixContactNameMatch = resolvePreferredPeerMatch(
            contactPeers,
            peer => normalizePeerDisplayName(peer)?.toLowerCase().startsWith(normalized) ?? false,
        );
        if (prefixContactNameMatch) {
            return prefixContactNameMatch;
        }

        const prefixContactIdentityLocalPartMatch = resolvePreferredPeerMatch(
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

        if (derivedNameIdentity) {
            const exactContactDerivedIdentityMatch = resolvePreferredPeerMatch(
                contactPeers,
                peer => resolveGlueIdentityForPeer(peer) === derivedNameIdentity,
            );
            if (exactContactDerivedIdentityMatch) {
                return exactContactDerivedIdentityMatch;
            }
        }
    }

    const prefixNameMatch = resolvePreferredPeerMatch(
        peers,
        peer => normalizePeerDisplayName(peer)?.toLowerCase().startsWith(normalized) ?? false,
    );
    if (prefixNameMatch) {
        return prefixNameMatch;
    }

    if (explicitHandle && normalizedHandleIdentity) {
        const exactIdentityMatch = resolvePreferredPeerMatch(
            peers,
            peer => resolveGlueIdentityForPeer(peer) === normalizedHandleIdentity,
        );
        if (exactIdentityMatch) {
            return exactIdentityMatch;
        }

        const exactIdentityLocalPartMatch = resolvePreferredPeerMatch(
            peers,
            peer => {
                const identity = resolveGlueIdentityForPeer(peer);
                return identity?.slice(0, identity.indexOf('@')) === normalizedHandleLocalPart;
            },
        );
        if (exactIdentityLocalPartMatch) {
            return exactIdentityLocalPartMatch;
        }

        const prefixIdentityMatch = resolvePreferredPeerMatch(
            peers,
            peer => resolveGlueIdentityForPeer(peer)?.startsWith(normalizedHandleIdentity) ?? false,
        );
        if (prefixIdentityMatch) {
            return prefixIdentityMatch;
        }

        const prefixIdentityLocalPartMatch = resolvePreferredPeerMatch(
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

    const registeredPersonId = await resolveRegisteredPersonId(
        explicitHandle && normalizedHandleIdentity
            ? normalizedHandleIdentity
            : token,
        options,
    );
    if (registeredPersonId) {
        return registeredPersonId;
    }

    if (isHexIdInput && normalized.length >= MIN_DIRECT_PERSON_ID_LENGTH) {
        return token.trim();
    }

    if (isHexIdInput && normalized.length >= MIN_PERSON_ID_PREFIX_LENGTH) {
        return null;
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
    const [contactQuery, setContactQuery] = useState('');
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [manualLabels, setManualLabels] = useState<Record<string, string>>({});
    const unselectedPeers = useMemo(
        () => peers.filter(peer => !value.includes(peer.personId)),
        [peers, value],
    );
    const suggestedPeers = useMemo(() => {
        const query = contactQuery.trim().toLowerCase();
        return unselectedPeers
            .filter(peer => !query || [peer.displayName, peer.glueIdentity, peer.personId]
                .some(value => value?.toLowerCase().includes(query)))
            .sort((left, right) => Number(right.online) - Number(left.online)
                || Number(right.hasVerifiedIdentity) - Number(left.hasVerifiedIdentity)
                || (left.displayName ?? left.personId).localeCompare(right.displayName ?? right.personId))
            .slice(0, 12);
    }, [contactQuery, unselectedPeers]);

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

        setErrorMessage(`Looking up ${token}…`);
        const personId = await resolveTokenToPersonId(token, peers);
        if (!personId) {
            setErrorMessage(/^[0-9a-f]{8,15}$/i.test(token)
                ? 'Ambiguous or incomplete person ID. Enter the full ID.'
                : token.includes('@') || token.startsWith('@')
                    ? 'Identity is not registered or could not be found.'
                    : 'No trusted contact or registered identity matched this value.');
            return;
        }

        if (value.includes(personId)) {
            setErrorMessage('This identity is already selected.');
            return;
        }

        const manualIdentityLabel = normalizeExplicitGlueIdentity(token) ?? token.trim();
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

    return (
        <div className="space-y-2">
            <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-2">
                {value.length === 0 ? (
                    <span className="text-xs text-white/55">{emptyLabel}</span>
                ) : (
                    value.map(personId => (
                        <span
                            key={personId}
                            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[#e94560]/25 bg-[#e94560]/10 pl-3 text-xs text-[#ffb5c3]"
                        >
                            <span>{resolveSelectedPeerLabel(personId)}</span>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                    void applyChange(value.filter(entry => entry !== personId));
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-full text-[#ffb5c3]/75 transition-colors hover:bg-white/10 hover:text-white"
                                aria-label={`Remove ${personId}`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))
                )}
            </div>

            <label className="flex min-h-11 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 focus-within:border-[#ff9db0]/60">
                <Search className="h-4 w-4 text-white/55" />
                <input type="search" value={contactQuery} onChange={event => setContactQuery(event.target.value)} placeholder="Search trusted contacts" className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/55" />
            </label>

            <div className="max-h-72 space-y-1 overflow-y-auto" aria-label="Trusted contacts">
                {suggestedPeers.map(peer => (
                    <button key={peer.personId} type="button" disabled={saving} onClick={() => { void applyChange([...value, peer.personId]); }} className="flex min-h-11 w-full items-center gap-3 rounded-md border border-white/8 bg-white/[0.035] px-3 text-left hover:bg-white/8 disabled:opacity-40">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${peer.online ? 'bg-emerald-400' : 'bg-white/25'}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white/85">{peer.displayName ?? peer.glueIdentity ?? `${peer.personId.slice(0, 12)}…`}</span><span className="block truncate text-xs text-white/50">{peer.hasVerifiedIdentity ? 'Verified identity' : 'Identity not verified'} · {peer.online ? 'Online' : 'Offline'}</span></span>
                        <UserPlus className="h-4 w-4 text-white/50" />
                    </button>
                ))}
                {suggestedPeers.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-3 text-xs text-white/50">{contactQuery ? 'No trusted contacts match this search.' : 'No trusted contacts available.'}</p> : null}
            </div>

            <details className="rounded-md border border-white/8 bg-black/15">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-xs text-white/65 hover:text-white">Invite by identity or ID</summary>
                <div className="flex gap-2 border-t border-white/8 p-2">
                    <input type="text" value={draft} disabled={saving} placeholder={placeholder} onChange={event => { setDraft(event.target.value); setErrorMessage(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitDraft(); } }} className="min-h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/55 focus:border-[#ff9db0]/60" />
                    <button type="button" disabled={saving || !normalizeToken(draft)} onClick={() => { void commitDraft(); }} className="min-h-11 rounded-md bg-[#e94560] px-4 text-xs font-medium text-white disabled:opacity-35">{saving ? 'Looking up…' : 'Add'}</button>
                </div>
                {errorMessage ? <div role="status" className={`px-3 pb-3 text-xs ${errorMessage.startsWith('Looking up') ? 'text-white/60' : 'text-[#ff9db0]'}`}>{errorMessage}</div> : null}
            </details>
        </div>
    );
}

import {useEffect, useMemo, useState} from 'react';
import QRCode from 'qrcode';
import {Check, Copy, Share2, Unlink} from 'lucide-react';

interface ShareInviteCardProps {
    invite: {
        url: string;
        pin: string;
        sharedCount?: number;
        payload: {expiresAt: string};
    };
    onRevoke: () => void;
}

function relativeExpiry(expiresAt: string): string {
    const remainingMs = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'expired';
    const hours = Math.ceil(remainingMs / 3_600_000);
    if (hours < 48) return new Intl.RelativeTimeFormat(undefined, {numeric: 'always'}).format(hours, 'hour');
    return new Intl.RelativeTimeFormat(undefined, {numeric: 'always'}).format(Math.ceil(hours / 24), 'day');
}

export function ShareInviteCard({invite, onRevoke}: ShareInviteCardProps) {
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
    const expiry = useMemo(() => relativeExpiry(invite.payload.expiresAt), [invite.payload.expiresAt]);

    useEffect(() => {
        let cancelled = false;
        void QRCode.toDataURL(invite.url, {width: 240, margin: 1, errorCorrectionLevel: 'M'})
            .then(url => { if (!cancelled) setQrDataUrl(url); });
        return () => { cancelled = true; };
    }, [invite.url]);

    const copyLink = async () => {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
            await navigator.clipboard.writeText(invite.url);
            setCopyStatus('copied');
            window.setTimeout(() => setCopyStatus('idle'), 1800);
        } catch {
            setCopyStatus('error');
        }
    };

    const shareLink = typeof navigator.share === 'function'
        ? async () => navigator.share({
            title: 'Fotos gallery invitation',
            text: `Open this private fotos invitation. PIN: ${invite.pin}`,
            url: invite.url,
        })
        : null;

    return (
        <section aria-label="Share link result" className="space-y-3 rounded-xl border border-white/12 bg-black/25 p-3">
            <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
                <div className="flex min-h-36 items-center justify-center rounded-lg bg-white p-2">
                    {qrDataUrl ? <img src={qrDataUrl} alt="QR code for this fotos invitation" className="h-32 w-32" /> : <span className="text-xs text-black/55">Preparing QR…</span>}
                </div>
                <dl className="grid content-start grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                    {typeof invite.sharedCount === 'number' ? <><dt className="text-white/55">Scope</dt><dd className="text-white/85">Gallery · {invite.sharedCount} photos</dd></> : null}
                    <dt className="text-white/55">PIN</dt><dd className="font-mono text-lg tracking-[0.3em] text-white" aria-label={`PIN ${invite.pin.split('').join(' ')}`}>{invite.pin}</dd>
                    <dt className="text-white/55">Expires</dt><dd className="text-white/80">{expiry} · {new Date(invite.payload.expiresAt).toLocaleString()}</dd>
                </dl>
            </div>
            <p className="text-xs leading-relaxed text-white/60">This is a private pairing invitation, not a public album. Send the PIN through a channel the recipient can access.</p>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { void copyLink(); }} className="flex min-h-11 items-center gap-2 rounded-md bg-[#e94560] px-3 text-xs font-medium text-white hover:bg-[#d13354]">
                    {copyStatus === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy link'}
                </button>
                {shareLink ? <button type="button" onClick={() => { void shareLink(); }} className="flex min-h-11 items-center gap-2 rounded-md bg-white/10 px-3 text-xs text-white/80 hover:bg-white/15"><Share2 className="h-4 w-4" />Share…</button> : null}
                <button type="button" onClick={onRevoke} className="flex min-h-11 items-center gap-2 rounded-md px-3 text-xs text-red-200 hover:bg-red-500/12"><Unlink className="h-4 w-4" />Revoke link</button>
            </div>
            <span className="sr-only" aria-live="polite">{copyStatus === 'copied' ? 'Invitation link copied' : copyStatus === 'error' ? 'Could not copy the invitation link' : ''}</span>
        </section>
    );
}

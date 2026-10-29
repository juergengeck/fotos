import {useEffect, useState} from 'react';
import {QrCode} from 'lucide-react';
import {QrScanner} from '@vger/vger.ui/components/ui/qr-scanner';
import {parseFotosShareInviteUrl} from '@/lib/fotosShareInvite';

interface ReceiveInvitationProps {
    active?: boolean;
    pairing?: {
        acceptPairingInvitation(params: {invitationUrl: string}): Promise<{success: boolean; error?: string}>;
    };
    onOpenGalleryInvitation: (url: string) => void;
}

/** Reuse the camera decoder and the existing pairing/PIN flows. */
export function ReceiveInvitation({active = true, pairing, onOpenGalleryInvitation}: ReceiveInvitationProps) {
    const [scanning, setScanning] = useState(false);
    const [invitation, setInvitation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const galleryInvite = parseFotosShareInviteUrl(invitation);

    useEffect(() => { if (!active) setScanning(false); }, [active]);

    return <div className="space-y-2">
        <button type="button" disabled={!active || busy} aria-pressed={scanning}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 px-2.5 py-2 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50"
            onClick={() => {setError(''); setNotice(''); setScanning(value => !value);}}>
            <QrCode className="h-4 w-4" aria-hidden="true" />
            {scanning ? 'Stop scanning' : 'Scan invitation QR code'}
        </button>
        <QrScanner active={active && scanning}
            scanHint="Point the camera at a Fotos gallery or device invitation."
            unsupportedMessage="Camera scanning is unavailable in this browser. Paste the invitation link below."
            cameraErrorMessage="Could not use the camera."
            detectionErrorMessage="Could not read QR codes from the camera."
            onScan={value => {setScanning(false); setInvitation(value); setError(''); setNotice('');}}
            onError={message => {setScanning(false); setError(message);}} />
        <form className="space-y-2" onSubmit={async event => {
            event.preventDefault();
            if (busy || !invitation.trim()) return;
            setError(''); setNotice(''); setScanning(false);
            if (galleryInvite) {onOpenGalleryInvitation(invitation.trim()); return;}
            if (!pairing) {setError('Device pairing is still preparing. Try again when Fotos is ready.'); return;}
            setBusy(true);
            try {
                const result = await pairing.acceptPairingInvitation({invitationUrl: invitation.trim()});
                if (!result.success) throw new Error(result.error || 'Could not accept this invitation.');
                setInvitation(''); setNotice('Invitation accepted. You can now share with the connected device.');
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Could not accept this invitation.');
            } finally {setBusy(false);}
        }}>
            <label className="block space-y-1 text-xs text-white/65">
                <span>Invitation link</span>
                <input value={invitation} disabled={busy} onChange={event => {setInvitation(event.target.value); setError(''); setNotice('');}}
                    placeholder="Scan a QR code or paste a link"
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white/80" />
            </label>
            <button type="submit" disabled={busy || !invitation.trim()}
                className="w-full rounded-md border border-white/15 px-2.5 py-2 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50">
                {busy ? 'Connecting…' : galleryInvite ? 'Open gallery invitation' : 'Accept invitation'}
            </button>
        </form>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {notice && <p role="status" className="text-xs text-emerald-200">{notice}</p>}
    </div>;
}

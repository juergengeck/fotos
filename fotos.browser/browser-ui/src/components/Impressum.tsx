import { useEffect, useRef, useState } from 'react';

export function Impressum() {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const dialog = dialogRef.current;
        const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button, a[href]') ?? []);
        focusable()[0]?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            triggerRef.current?.focus();
        };
    }, [open]);

    return (
        <>
            <footer className="w-full py-4 px-6 flex items-center justify-center gap-4 text-xs text-white/40 border-t border-white/5">
                <span className="inline-flex items-center gap-1.5">
                    powered by{' '}
                    <a href="https://refinio.net" target="_blank" rel="noopener" className="flex min-h-11 items-center rounded-md px-2 hover:bg-white/5 hover:text-white/60 transition-colors">
                        <img src="/refinio-logo.svg" alt="REFINIO" className="h-3.5 opacity-50 hover:opacity-80 transition-opacity inline" />
                    </a>
                </span>
                <button ref={triggerRef} onClick={() => setOpen(true)} className="min-h-11 rounded-md px-2 hover:bg-white/5 hover:text-white/60 transition-colors">
                    Impressum
                </button>
            </footer>

            {open && (
                <div
                    className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-8"
                    onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
                >
                    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="impressum-title" className="bg-[#1a1a2e] border border-white/10 rounded-xl p-8 max-w-md w-full relative text-sm text-white/60 leading-relaxed">
                        <button
                            onClick={() => setOpen(false)}
                            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md text-xl text-white/55 hover:bg-white/5 hover:text-white transition-colors"
                            aria-label="Close legal notice"
                        >
                            &times;
                        </button>
                        <h3 id="impressum-title" className="text-white font-semibold text-base mb-3">Impressum</h3>
                        <p className="mb-2">Angaben gem&auml;&szlig; &sect; 5 TMG</p>
                        <address className="not-italic mb-3">
                            <strong className="text-white/80">REFINIO GmbH</strong><br />
                            Steiner Str. 6<br />
                            91189 Rohr
                        </address>
                        <p className="mb-3">
                            <strong className="text-white/80">Gesch&auml;ftsf&uuml;hrer:</strong><br />
                            J&uuml;rgen Geck
                        </p>
                        <p className="mb-3">
                            <strong className="text-white/80">Kontakt:</strong><br />
                            Telefon: +49 (0) 911 63291636<br />
                            E-Mail: <a href="mailto:info@refinio.net" className="text-[#e94560] hover:underline">info@refinio.net</a>
                        </p>
                        <p className="mb-3">
                            <strong className="text-white/80">Registereintrag:</strong><br />
                            Eingetragen im Handelsregister beim Amtsgericht N&uuml;rnberg<br />
                            Registernummer: HRB 34222
                        </p>
                        <p className="mb-3">
                            <strong className="text-white/80">Umsatzsteuer-ID:</strong><br />
                            DE313675989
                        </p>
                        <p className="text-xs mt-4">
                            Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}

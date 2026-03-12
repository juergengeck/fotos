import { useState } from 'react';

export function Impressum() {
    const [open, setOpen] = useState(false);

    return (
        <>
            <footer className="w-full py-4 px-6 flex items-center justify-center gap-4 text-xs text-white/40 border-t border-white/5">
                <span className="inline-flex items-center gap-1.5">
                    powered by{' '}
                    <a href="https://refinio.net" target="_blank" rel="noopener" className="hover:text-white/60 transition-colors">
                        <img src="/refinio-logo.svg" alt="REFINIO" className="h-3.5 opacity-50 hover:opacity-80 transition-opacity inline" />
                    </a>
                </span>
                <button onClick={() => setOpen(true)} className="hover:text-white/60 transition-colors">
                    Impressum
                </button>
            </footer>

            {open && (
                <div
                    className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-8"
                    onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
                >
                    <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-8 max-w-md w-full relative text-sm text-white/60 leading-relaxed">
                        <button
                            onClick={() => setOpen(false)}
                            className="absolute top-3 right-4 text-xl text-white/40 hover:text-white/70 transition-colors"
                        >
                            &times;
                        </button>
                        <h3 className="text-white font-semibold text-base mb-3">Impressum</h3>
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

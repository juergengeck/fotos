import type { ReactNode } from 'react';
import { ArrowUpRight, FolderOpen, HardDrive, Images } from 'lucide-react';
import { Impressum } from './Impressum';

interface LibraryStartProps {
    onOpenFolder: () => void;
    selectPhotos: boolean;
    actionLabel: string;
    summary: string;
    pendingImportCount: number;
    children?: ReactNode;
}

/** The empty library is an app workspace; product information lives at /. */
export function LibraryStart({onOpenFolder, selectPhotos, actionLabel, summary, pendingImportCount, children}: LibraryStartProps) {
    return <div className="flex min-h-dvh flex-col bg-[#111] text-white/85 view-enter">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5 sm:px-7">
            <div className="flex items-center gap-3">
                <img src="/app/cam.svg" alt="" className="h-7 w-7 invert" />
                <span className="text-lg font-semibold tracking-tight">fotos<span className="text-[#e94560]">.</span>one</span>
                <span className="ml-2 border-l border-white/15 pl-4 text-sm text-white/50">Library</span>
            </div>
            <a href="/" className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-white/55 hover:bg-white/5 hover:text-white">About Fotos <ArrowUpRight className="h-3.5 w-3.5" /></a>
        </header>
        <div className="flex flex-1">
            <aside aria-label="Library overview" className="hidden w-60 shrink-0 flex-col border-r border-white/10 bg-white/[0.015] px-4 py-6 md:flex">
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.07] px-3 py-3 text-sm"><Images className="h-4 w-4 text-[#e94560]" />Photo library</div>
                <p className="px-3 pt-4 text-xs leading-relaxed text-white/40">No library open</p>
                <div className="mt-auto px-3 pt-12 text-xs leading-relaxed text-white/45">
                    <HardDrive className="mb-3 h-4 w-4" />
                    Your library stays on this device. Open a folder to browse its photos.
                </div>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col px-6 py-8 sm:px-10">
                <div className="mb-10 border-b border-white/10 pb-5">
                    <h1 className="text-xl font-semibold tracking-tight">Photo library</h1>
                    <p className="mt-1 text-sm text-white/45">{selectPhotos ? 'Choose photos to get started.' : 'Open a folder to get started.'}</p>
                </div>
                <section aria-labelledby="open-library-title" className="my-auto w-full max-w-2xl self-center rounded-2xl border border-white/10 bg-[#171717] p-6 sm:p-10">
                    <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[#e94560]/10 text-[#e94560]"><FolderOpen className="h-6 w-6" /></div>
                    <h2 id="open-library-title" className="text-2xl font-semibold tracking-tight">{selectPhotos ? 'Choose photos for your library' : 'Open your photo library'}</h2>
                    <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/55">{selectPhotos ? 'Select photos from this device to add to your library.' : 'Choose a photo folder on this device.'} Fotos will show your photos here so you can browse, organize, and find people.</p>
                    {pendingImportCount > 0 && <p role="status" className="mt-5 rounded-lg border border-[#e94560]/30 bg-[#e94560]/10 px-4 py-3 text-sm text-white/80">{pendingImportCount} shared photo{pendingImportCount === 1 ? ' is' : 's are'} ready to be stored locally.</p>}
                    <button onClick={onOpenFolder} className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#e94560] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#d13354] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9db0]"><FolderOpen className="h-4 w-4" />{actionLabel}</button>
                    <p className="mt-4 max-w-lg text-xs leading-relaxed text-white/45">{summary}</p>
                    {children && <div className="mt-5 border-t border-white/10 pt-3">{children}</div>}
                </section>
                <p className="mt-8 text-center text-xs text-white/35">Your originals stay in place. No cloud upload.</p>
            </main>
        </div>
        <Impressum />
    </div>;
}

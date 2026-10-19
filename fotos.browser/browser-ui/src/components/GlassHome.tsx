import {appPath} from '@/lib/appBase';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, Heart, Image, Images, Upload, UserRound, FolderOpen, Plus, Pencil, Share2, Trash2} from 'lucide-react';
import type {PhotoEntry} from '@refinio/fotos.ui';
import type {FotosCollectionSummary} from '@/lib/fotosCollections';
import type {GlassView} from '@/lib/glassNavigation';
import {Impressum} from './Impressum';
import './glass-home.css';

const PETAL_PATH = 'M .5 .455 C .455 .455 .275 .365 .195 .315 C .105 .26 .11 .205 .175 .145 C .265 .065 .375 .045 .5 .045 C .625 .045 .735 .065 .825 .145 C .89 .205 .895 .26 .805 .315 C .725 .365 .545 .455 .5 .455 Z';
const PETALS = [{name: 'gallery', label: 'Gallery', angle: 0, Icon: Image}, {name: 'albums', label: 'Albums', angle: 120, Icon: Images}, {name: 'favorites', label: 'Favorites', angle: 240, Icon: Heart}] as const;
const DESTINATIONS = [...PETALS, {name: 'profile', label: 'Profile', Icon: UserRound}] as const;

interface GlassHomeProps {
    view: GlassView;
    entries: PhotoEntry[];
    collections: FotosCollectionSummary[];
    getThumbUrl: (photo: PhotoEntry) => Promise<string | null>;
    onNavigate: (view: GlassView) => void;
    onUpload: () => void;
    onOpenFolder: () => void;
    onAlbum: (id: string) => void;
    onCreateAlbum: (name: string) => void;
    onRenameAlbum: (album: FotosCollectionSummary) => void;
    onDeleteAlbum: (id: string) => void;
    onShareAlbum: (id: string) => void;
    pendingImportCount: number;
    progressLabel: string | null;
    importError?: string | null;
    onDismissImportError: () => void;
    children: ReactNode;
}

function AlbumCover({photo, getThumbUrl}: {photo?: PhotoEntry; getThumbUrl: GlassHomeProps['getThumbUrl']}) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        setUrl(null);
        if (photo) void getThumbUrl(photo).then(value => {if (live) setUrl(value);}).catch(() => {});
        return () => {live = false;};
    }, [photo, getThumbUrl]);
    return url ? <img src={url} alt="" loading="lazy" /> : <Images size={36} strokeWidth={1.2} aria-hidden="true" />;
}

export function GlassHome(props: GlassHomeProps) {
    const {view, onNavigate} = props;
    const [background, setBackground] = useState(appPath('glass-landscape.jpg'));
    const [albumName, setAlbumName] = useState('');
    const [lastDestination, setLastDestination] = useState<GlassView>(view === 'home' ? 'gallery' : view);
    const headerRef = useRef<HTMLHeadingElement>(null);
    const previousView = useRef(view);
    const backgroundPhoto = props.entries.find(entry => entry.thumb) ?? props.entries[0];
    useEffect(() => {
        let live = true;
        if (backgroundPhoto) void props.getThumbUrl(backgroundPhoto).then(url => {if (live && url) setBackground(url);}).catch(() => {});
        else setBackground(appPath('glass-landscape.jpg'));
        return () => {live = false;};
    }, [backgroundPhoto, props.getThumbUrl]);
    useEffect(() => {
        if (view !== 'home') setLastDestination(view);
        if (previousView.current !== view) {
            if (view === 'home') document.querySelector<HTMLButtonElement>('.petal-gallery')?.focus();
            else headerRef.current?.focus();
            previousView.current = view;
        }
    }, [view]);
    const title = view === 'profile' ? 'Profile & preferences' : view[0].toUpperCase() + view.slice(1);
    return <main className="glass-home">
        <div className="glass-background" style={{backgroundImage: `url("${background}")`}} aria-hidden="true" />
        <div className="glass-background glass-background-periphery" style={{backgroundImage: `url("${background}")`}} aria-hidden="true" />
        <div className="glass-wash" aria-hidden="true" />
        <div className="glass-home-navigation" hidden={view !== 'home'}>
            <span className="glass-wordmark" aria-label="Fotos ONE">fotos<span> ONE</span></span>
            <div className="glass-home-legal"><Impressum /></div>
            <nav className="petal-composition" aria-label="Photo navigation">
                <svg className="petal-shape-definitions" aria-hidden="true" width="0" height="0"><defs>
                    {PETALS.map(({name, angle}) => <clipPath key={name} id={`fotos-petal-${name}`} clipPathUnits="objectBoundingBox">
                        <path d={PETAL_PATH} transform={`rotate(${angle} .5 .5) translate(.5 .5) scale(.66 .88) translate(-.5 -.5)`} />
                    </clipPath>)}
                </defs></svg>
                <span className="petal-junction" aria-hidden="true" />
                {PETALS.map(({name, label, Icon}) => <button key={name} className={`glass-petal petal-${name} ${name === lastDestination ? 'is-selected' : ''}`} onClick={() => onNavigate(name)}>
                    <span><Icon size={25} strokeWidth={1.4} aria-hidden="true" /><span>{label}</span></span>
                </button>)}
                <svg className="petal-edge-highlights" viewBox="0 0 1 1" aria-hidden="true">
                    {PETALS.map(({name, angle}) => <path key={name} d={PETAL_PATH} transform={`rotate(${angle} .5 .5) translate(.5 .5) scale(.66 .88) translate(-.5 -.5)`} />)}
                </svg>
            </nav>
            <div className="glass-bottom-actions">
                <button className="glass-action glass-upload" onClick={props.onUpload}><Upload size={24} strokeWidth={1.4} aria-hidden="true" /><span>Upload Photos</span></button>
                <button className="glass-action glass-profile" onClick={() => onNavigate('profile')}><UserRound size={24} strokeWidth={1.4} aria-hidden="true" /><span>Profile</span></button>
            </div>
        </div>
        <section className="glass-destination" hidden={view === 'home'} aria-label={title}>
            <header className="glass-panel-header">
                <button onClick={() => onNavigate('home')} aria-label="Back to home"><ArrowLeft size={21} /></button>
                <h1 tabIndex={-1} ref={headerRef}>{title}</h1>
                <div className="glass-header-actions">
                    <button onClick={props.onOpenFolder} aria-label="Open photo folder" title="Open photo folder"><FolderOpen size={20} /></button>
                    <button onClick={props.onUpload} aria-label="Upload Photos" title="Upload Photos"><Upload size={20} /></button>
                </div>
            </header>
            <nav className="glass-section-nav" aria-label="Library navigation">
                {DESTINATIONS.map(({name, label, Icon}) => <button key={name} onClick={() => onNavigate(name)} aria-current={view === name ? 'page' : undefined}><Icon size={17} aria-hidden="true" />{label}</button>)}
            </nav>
            {view === 'albums' && <div className="glass-panel-body">
                <div className="glass-albums-heading"><p className="glass-panel-intro">Little collections. Lasting memories.</p>
                    <form className="glass-album-create" onSubmit={event => {event.preventDefault(); if (albumName.trim()) {props.onCreateAlbum(albumName.trim()); setAlbumName('');}}}>
                        <input aria-label="Album name" placeholder="Name a new album" value={albumName} onChange={event => setAlbumName(event.target.value)} maxLength={120} />
                        <button disabled={!albumName.trim()} type="submit"><Plus size={18} />Create album</button>
                    </form>
                </div>
                {props.collections.length ? <div className="glass-album-list">{props.collections.map(album => <article key={album.id} className="glass-album-card">
                    <button className="glass-album-open" onClick={() => props.onAlbum(album.id)}>
                        <span className="glass-album-cover"><AlbumCover photo={props.entries.find(photo => photo.hash === album.coverPhotoHash)} getThumbUrl={props.getThumbUrl} /></span>
                        <span>{album.name}<small>{album.photoCount} photos · {album.faceCount} faces</small></span>
                    </button>
                    <div className="glass-album-actions">
                        <button onClick={() => props.onRenameAlbum(album)} aria-label={`Rename ${album.name}`}><Pencil size={16} />Rename</button>
                        <button onClick={() => props.onShareAlbum(album.id)} aria-label={`Share ${album.name}`}><Share2 size={16} />Share</button>
                        <button onClick={() => props.onDeleteAlbum(album.id)} aria-label={`Delete ${album.name}`}><Trash2 size={16} />Delete</button>
                    </div>
                </article>)}</div> : <div className="glass-empty"><Images size={38} strokeWidth={1} /><h2>Your stories live here</h2><p>Create an album above. In Gallery, select photos or people and choose Add to collection to fill it.</p><button onClick={() => onNavigate('gallery')}>Browse photos</button></div>}
            </div>}
            <div className="glass-library-content" hidden={view === 'home' || view === 'albums'}>{props.children}</div>
        </section>
        {props.pendingImportCount > 0 && <aside className="glass-intake-notice" aria-label="Pending shared photos"><p>{props.pendingImportCount} shared photo{props.pendingImportCount === 1 ? '' : 's'} waiting for a destination.</p><button onClick={props.onOpenFolder}>Choose destination</button></aside>}
        {props.progressLabel && <div className="glass-progress" role="status" aria-live="polite">{props.progressLabel}</div>}
        {props.importError && <aside className="glass-import-error" role="alert"><p>{props.importError}</p><button onClick={props.onUpload}>Try again</button><button onClick={props.onDismissImportError}>Dismiss</button></aside>}
    </main>;
}

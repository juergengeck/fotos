import {useEffect, useRef, useState} from 'react';
import {getMediaPlaybackKind} from '@refinio/media.core/media-types';
import type {PhotoEntry} from '@/types/fotos';
import {TimedMediaPlayer} from './TimedMediaPlayer.js';

/** Mounted only after an explicit playback request; unmount releases media work. */
export function InlineMediaPlayer({photo, getFileUrl}: {
    photo: PhotoEntry;
    getFileUrl: (path: string) => Promise<string>;
}) {
    const [source, setSource] = useState<{url?: string; error?: string}>({});
    const kind = getMediaPlaybackKind(photo.name, photo.mimeType);
    useEffect(() => {
        let active = true;
        setSource({});
        void getFileUrl(photo.sourcePath ?? photo.name).then(url => {
            if (active) setSource({url});
        }).catch(error => {
            if (active) setSource({error: error instanceof Error ? error.message : String(error)});
        });
        return () => { active = false; };
    }, [getFileUrl, photo.sourcePath, photo.name]);

    return (
        <div className="absolute inset-0 flex items-center justify-center bg-black" data-media-controls
            onKeyDown={event => {
                const ownerDocument = event.currentTarget.ownerDocument as Document & {webkitFullscreenElement?: Element};
                const video = event.currentTarget.querySelector('video') as (HTMLVideoElement & {webkitDisplayingFullscreen?: boolean}) | null;
                // Leave native fullscreen Escape to the browser without also exiting
                // the gallery. Otherwise Escape remains the gallery's exit key.
                if (event.key !== 'Escape' || ownerDocument.fullscreenElement || ownerDocument.webkitFullscreenElement || video?.webkitDisplayingFullscreen) {
                    event.stopPropagation();
                }
            }}>
            {source.error ? <p role="alert" className="p-3 text-sm text-red-200">Unable to play {photo.name}: {source.error}</p>
                : !source.url ? <p role="status" className="text-sm text-white/70">Loading media…</p>
                : kind === 'video' ? <InlineVideo key={source.url} src={source.url} name={photo.name} />
                : <TimedMediaPlayer src={source.url} name={photo.name} compact
                    mediaStyle={{width: '100%', height: '100%', objectFit: 'contain'}} onReady={() => {}} />}
        </div>
    );
}

function InlineVideo({src, name}: {src: string; name: string}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const video = videoRef.current;
        return () => {
            if (!video) return;
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [src]);
    return <video ref={videoRef} src={src} controls autoPlay playsInline preload="metadata"
        aria-label={`Video: ${name}`} className="h-full w-full object-contain" />;
}

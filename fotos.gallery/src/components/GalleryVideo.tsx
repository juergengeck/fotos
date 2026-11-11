import { useEffect, useRef, useState, type CSSProperties } from 'react'

export interface GalleryVideoPlayback {
  active: boolean
  positions: Map<string, number>
}

const buttonStyle: CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'grid',
  placeItems: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: 6,
  color: '#fff',
  background: 'rgba(0,0,0,0.65)',
  zIndex: 1,
}

export function GalleryVideo({
  id, name, url, loaded, style, playback, onDimensions, onOpen,
}: {
  id: string
  name: string
  url?: string
  loaded: boolean
  style: CSSProperties
  playback?: GalleryVideoPlayback
  onDimensions?: (width: number, height: number) => void
  onOpen?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(Boolean(playback))
  const active = playback?.active
  const positions = playback?.positions

  useEffect(() => {
    const video = videoRef.current
    if (!video || !positions) return

    return () => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        if (video.ended || video.currentTime === 0) positions.delete(id)
        else positions.set(id, video.currentTime)
      }
      video.pause()
    }
  }, [id, positions, url])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !loaded || active === undefined) return
    if (!active) {
      video.pause()
      return
    }

    let fullyVisible = false
    const sync = () => {
      if (!fullyVisible || document.visibilityState !== 'visible') video.pause()
      else if (!video.ended) void video.play().catch(() => {})
    }
    // Allow subpixel rounding at a scroll boundary. Use the most recent
    // observation when a resize or scroll crossed several thresholds.
    const fullVisibilityThreshold = 0.999
    const observer = new IntersectionObserver(entries => {
      const entry = entries.at(-1)
      fullyVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= fullVisibilityThreshold)
      sync()
    }, { threshold: [0, fullVisibilityThreshold] })
    observer.observe(video)
    document.addEventListener('visibilitychange', sync)

    return () => {
      observer.disconnect()
      observer.takeRecords()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [active, loaded, url])

  return (
    <>
      {url && (
        <video
          key={url}
          ref={videoRef}
          src={url}
          aria-label={name}
          controls
          playsInline
          muted={muted}
          preload="metadata"
          onLoadedMetadata={({ currentTarget: video }) => {
            const position = positions?.get(id)
            if (position !== undefined && position < video.duration) video.currentTime = position
            onDimensions?.(video.videoWidth, video.videoHeight)
          }}
          onResize={({ currentTarget: video }) => onDimensions?.(video.videoWidth, video.videoHeight)}
          onVolumeChange={({ currentTarget: video }) => setMuted(video.muted)}
          style={style}
        />
      )}
      {playback && loaded && (
        <button
          type="button"
          aria-label={`${muted ? 'Unmute' : 'Mute'} ${name}`}
          title={`${muted ? 'Unmute' : 'Mute'} ${name}`}
          onClick={() => {
            const video = videoRef.current
            if (!video) return
            const wasPlaying = !video.paused
            video.muted = !video.muted
            setMuted(video.muted)
            if (!video.muted && wasPlaying) {
              void video.play().catch(() => {})
            }
          }}
          style={{ ...buttonStyle, insetInlineStart: 4, cursor: 'pointer' }}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            {muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
          </svg>
        </button>
      )}
      {onOpen && <button
        type="button"
        data-gallery-open
        aria-label={`Open ${name}`}
        title={`Open ${name}`}
        onClick={() => {
          videoRef.current?.pause()
          onOpen()
        }}
        style={{ ...buttonStyle, insetInlineEnd: 4, cursor: 'zoom-in' }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2h5v5M14 2 9 7M7 14H2V9m0 5 5-5" />
        </svg>
      </button>}
    </>
  )
}

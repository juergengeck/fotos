import { useEffect } from 'react'
import type { GalleryEntry } from '../types/gallery.js'

export interface LightboxProps<T extends GalleryEntry = GalleryEntry> {
  items: T[]
  index: number
  /** Resolve entry to a displayable URL (or undefined if loading) */
  getImageUrl: (entry: T) => string | undefined
  onIndexChange: (index: number) => void
  onClose: () => void
  /** Optional content preview for the bottom bar */
  getPreview?: (entry: T) => string | null
}

function overlayButton(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    [side]: 16,
    transform: 'translateY(-50%)',
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(0,0,0,0.64)',
    color: '#fff',
    cursor: 'pointer',
    backdropFilter: 'blur(12px)',
    zIndex: 4,
  }
}

function chromeButton(inset: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: 16,
    [inset]: 16,
    width: 42,
    height: 42,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(0,0,0,0.64)',
    color: '#fff',
    cursor: 'pointer',
    backdropFilter: 'blur(12px)',
    zIndex: 4,
  }
}

export function Lightbox<T extends GalleryEntry>({
  items,
  index,
  getImageUrl,
  onIndexChange,
  onClose,
  getPreview,
}: LightboxProps<T>) {
  const entry = items[index]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndexChange])

  if (!entry) return null

  const url = getImageUrl(entry)
  const canPrev = index > 0
  const canNext = index < items.length - 1
  const preview = getPreview?.(entry) ?? null
  const timestamp = new Date(entry.timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.96)' }}
    >
      {/* Close */}
      <button type="button" onClick={onClose} aria-label="Close" style={chromeButton('right')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      {/* Download */}
      {url && (
        <a href={url} download={entry.name} style={chromeButton('left')} aria-label={`Download ${entry.name}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
      )}

      {/* Counter */}
      <div style={{
        position: 'absolute', top: 22, left: '50%', transform: 'translateX(-50%)',
        color: 'rgba(255,255,255,0.76)', fontSize: 12, letterSpacing: '0.05em', zIndex: 3,
      }}>
        {index + 1} / {items.length}
      </div>

      {/* Nav arrows */}
      {canPrev && (
        <button type="button" onClick={() => onIndexChange(index - 1)} aria-label="Previous" style={overlayButton('left')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      )}
      {canNext && (
        <button type="button" onClick={() => onIndexChange(index + 1)} aria-label="Next" style={overlayButton('right')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      )}

      {/* Image */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '76px 72px 132px', pointerEvents: 'none', zIndex: 1,
      }}>
        {url ? (
          <img src={url} alt={entry.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14 }}>{entry.name}</div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 22px 24px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.78), transparent)',
        color: '#fff', zIndex: 2,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', marginBottom: 6 }}>
          {entry.senderName && <div style={{ fontSize: 16, fontWeight: 700 }}>{entry.senderName}</div>}
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)' }}>{timestamp}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)' }}>{entry.name}</div>
        </div>
        {preview && (
          <div style={{ maxWidth: 720, fontSize: 13, color: 'rgba(255,255,255,0.84)', lineHeight: 1.55 }}>
            {preview}
          </div>
        )}
      </div>
    </div>
  )
}

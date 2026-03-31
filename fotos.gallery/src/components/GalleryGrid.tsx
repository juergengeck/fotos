import { useState, type ReactNode } from 'react'
import type { GalleryEntry, DayGroup } from '../types/gallery.js'
import { formatDayLabel } from '../lib/grouping.js'

export interface GalleryGridProps<T extends GalleryEntry = GalleryEntry> {
  dayGroups: DayGroup<T>[]
  /** Total flat count (for empty state) */
  totalCount: number
  /** Resolve entry hash to a displayable image URL */
  getImageUrl: (entry: T) => string | undefined
  /** Called when user clicks a photo. Index is flat across all groups. */
  onPhotoClick: (flatIndex: number) => void
  /** Minimum column width in px (default 148) */
  minColumnWidth?: number
  /** Offset sticky day labels when an app header overlays the scroll surface. */
  stickyHeaderOffset?: number
  emptyLabel?: ReactNode
}

function GalleryCard<T extends GalleryEntry>({
  entry,
  url,
  onClick,
}: {
  entry: T
  url: string | undefined
  onClick: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <button
      type="button"
      onClick={onClick}
      title={entry.name}
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        width: '100%',
        overflow: 'hidden',
        border: '1px solid var(--border, #333)',
        borderRadius: 14,
        padding: 0,
        background: 'var(--bg-secondary, #1a1a1a)',
        cursor: 'zoom-in',
      }}
    >
      {url && (
        <img
          src={url}
          alt={entry.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
        />
      )}
      {(!url || !loaded) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            color: 'var(--muted, #888)',
            fontSize: 12,
            textAlign: 'center',
            textTransform: 'lowercase',
          }}
        >
          {entry.name}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.04) 45%, transparent)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          insetInline: 0,
          bottom: 0,
          padding: '10px 12px 11px',
          color: '#fff',
          textAlign: 'left',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 11,
            color: 'rgba(255,255,255,0.8)',
            marginBottom: 4,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.senderName}
          </span>
          <span style={{ flexShrink: 0 }}>{time}</span>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.name}
        </div>
      </div>
    </button>
  )
}

export function GalleryGrid<T extends GalleryEntry>({
  dayGroups,
  totalCount,
  getImageUrl,
  onPhotoClick,
  minColumnWidth = 148,
  stickyHeaderOffset = 0,
  emptyLabel = 'no images yet',
}: GalleryGridProps<T>) {
  if (totalCount === 0) {
    return (
      <div style={{ padding: '40px 16px', color: 'var(--muted, #888)', textAlign: 'center' }}>
        {emptyLabel}
      </div>
    )
  }

  let flatIndex = 0

  return (
    <>
      {dayGroups.map(group => {
        const startIndex = flatIndex
        flatIndex += group.items.length

        return (
          <section key={group.date}>
            <div
              style={{
                position: 'sticky',
                top: stickyHeaderOffset,
                zIndex: 3,
                padding: '10px 16px 8px',
                backdropFilter: 'blur(12px)',
                background: 'color-mix(in srgb, var(--bg, #111) 86%, transparent)',
                borderBottom: '1px solid var(--border, #333)',
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted, #888)', textTransform: 'lowercase', letterSpacing: '0.04em' }}>
                {formatDayLabel(group.date)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted, #888)' }}>{group.items.length}</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
                gap: 8,
                padding: '12px 12px 14px',
              }}
            >
              {group.items.map((entry, i) => (
                <GalleryCard
                  key={entry.hash}
                  entry={entry}
                  url={getImageUrl(entry)}
                  onClick={() => onPhotoClick(startIndex + i)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
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
  /** Stream shows uncropped images; immersive fills rows at natural image proportions without gutters. */
  layout?: 'grid' | 'stream' | 'immersive'
  /** Number of images per immersive row (default 1). */
  columns?: number
  /** Called after immersive row dimensions or columns change and the browser has laid them out. */
  onLayoutChange?: () => void
  /** Offset sticky day labels when an app header overlays the scroll surface. */
  stickyHeaderOffset?: number
  /** Render sticky day headers inside the grid (default true). */
  showDayHeaders?: boolean
  emptyLabel?: ReactNode
}

function GalleryCard<T extends GalleryEntry>({
  entry,
  url,
  onClick,
  layout,
  day,
  aspectRatio,
  placement,
  onImageDimensions,
}: {
  entry: T
  url: string | undefined
  onClick: () => void
  layout: NonNullable<GalleryGridProps<T>['layout']>
  day: string
  aspectRatio?: number
  placement?: { row: number; width: number; offset: number }
  onImageDimensions?: (url: string, width: number, height: number) => void
}) {
  const [loadedUrl, setLoadedUrl] = useState<string>()
  const loaded = !!url && loadedUrl === url
  const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <button
      type="button"
      onClick={onClick}
      title={entry.name}
      data-gallery-day={layout === 'immersive' ? day : undefined}
      data-gallery-photo={layout === 'immersive' ? true : undefined}
      style={{
        position: 'relative',
        display: 'block',
        aspectRatio: layout === 'grid' || (layout === 'stream' && !loaded)
          ? '1 / 1'
          : layout === 'immersive' && !loaded ? aspectRatio ?? 1 : undefined,
        width: placement ? `${placement.width}%` : '100%',
        minWidth: layout === 'immersive' ? 0 : undefined,
        gridRow: placement?.row,
        gridColumn: placement ? 1 : undefined,
        marginInlineStart: placement ? `${placement.offset}%` : undefined,
        overflow: 'hidden',
        border: layout === 'grid' ? '1px solid var(--border, #333)' : 0,
        borderRadius: layout === 'grid' ? 14 : 0,
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
          onLoad={event => {
            setLoadedUrl(url)
            onImageDimensions?.(url, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
          }}
          style={{
            width: '100%',
            height: layout === 'grid' ? '100%' : 'auto',
            objectFit: layout === 'grid' ? 'cover' : 'contain',
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
      {layout !== 'immersive' && (
        <>
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
        </>
      )}
    </button>
  )
}

export function GalleryGrid<T extends GalleryEntry>({
  dayGroups,
  totalCount,
  getImageUrl,
  onPhotoClick,
  minColumnWidth = 148,
  layout = 'grid',
  columns = 1,
  onLayoutChange,
  stickyHeaderOffset = 0,
  showDayHeaders = true,
  emptyLabel = 'no images yet',
}: GalleryGridProps<T>) {
  const [imageRatios, setImageRatios] = useState<Map<string, number>>(() => new Map())
  const columnCount = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1

  useEffect(() => {
    if (layout !== 'immersive' || !onLayoutChange) return
    const frame = requestAnimationFrame(onLayoutChange)
    return () => cancelAnimationFrame(frame)
  }, [layout, columnCount, imageRatios, dayGroups, onLayoutChange])

  const reportImageDimensions = (url: string, width: number, height: number) => {
    if (width <= 0 || height <= 0) return
    const ratio = width / height
    if (!Number.isFinite(ratio)) return
    setImageRatios(previous => {
      if (previous.get(url) === ratio) return previous
      const next = new Map(previous)
      next.set(url, ratio)
      return next
    })
  }

  if (totalCount === 0) {
    return (
      <div style={{ padding: '40px 16px', color: 'var(--muted, #888)', textAlign: 'center' }}>
        {emptyLabel}
      </div>
    )
  }

  let flatIndex = 0
  const renderPhoto = (entry: T, day: string, index: number, url: string | undefined, placement?: { row: number; width: number; offset: number }) => {
    return (
      <GalleryCard
        key={entry.hash}
        entry={entry}
        layout={layout}
        day={day}
        aspectRatio={url ? imageRatios.get(url) : undefined}
        placement={placement}
        onImageDimensions={layout === 'immersive' ? reportImageDimensions : undefined}
        url={url}
        onClick={() => onPhotoClick(index)}
      />
    )
  }
  const renderPhotos = (group: DayGroup<T>) => {
    const startIndex = flatIndex
    flatIndex += group.items.length

    return group.items.map((entry, i) => renderPhoto(entry, group.date, startIndex + i, getImageUrl(entry)))
  }

  if (layout === 'immersive') {
    const entries = dayGroups.flatMap(group => group.items.map(entry => ({ entry, day: group.date, url: getImageUrl(entry) })))
    const photos = []

    for (let i = 0; i < entries.length; i += columnCount) {
      const row = entries.slice(i, i + columnCount)
      const ratios = row.map(({ url }) => imageRatios.get(url ?? '') ?? 1)
      const totalRatio = ratios.reduce((total, ratio) => total + ratio, 0)
      let offset = 0
      for (const [index, { entry, day, url }] of row.entries()) {
        const width = 100 * ratios[index] / totalRatio
        photos.push(renderPhoto(entry, day, i + index, url, {
          row: Math.floor(i / columnCount) + 1,
          width,
          offset,
        }))
        offset += width
      }
    }

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          alignItems: 'start',
          gap: 0,
          padding: 0,
        }}
      >
        {/* Keep photos as stable siblings: changing rows must not reload or fade them. */}
        {photos}
      </div>
    )
  }

  return (
    <>
      {dayGroups.map(group => {
        const photos = renderPhotos(group)

        return (
          <section key={group.date} data-gallery-day={group.date}>
            {showDayHeaders && (
              <div
                style={{
                  position: 'sticky',
                  top: stickyHeaderOffset + 10,
                  zIndex: 3,
                  padding: '10px 12px 0',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: '1px solid var(--border, #333)',
                    backdropFilter: 'blur(12px)',
                    background: 'color-mix(in srgb, var(--bg, #111) 74%, transparent)',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.16)',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted, #888)', textTransform: 'lowercase', letterSpacing: '0.04em' }}>
                    {formatDayLabel(group.date)}
                  </span>
                  <span
                    style={{
                      minWidth: 22,
                      padding: '2px 7px',
                      borderRadius: 999,
                      border: '1px solid var(--border, #333)',
                      background: 'color-mix(in srgb, var(--bg-secondary, #1a1a1a) 72%, transparent)',
                      fontSize: 10,
                      lineHeight: 1.3,
                      textAlign: 'center',
                      color: 'var(--muted, #888)',
                    }}
                  >
                    {group.items.length}
                  </span>
                </div>
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: layout === 'stream'
                  ? 'minmax(0, 1fr)'
                  : `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
                gap: layout === 'stream' ? 0 : 8,
                padding: layout === 'stream' ? 0 : '12px 12px 14px',
              }}
            >
              {photos}
            </div>
          </section>
        )
      })}
    </>
  )
}

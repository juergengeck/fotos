import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { GalleryEntry } from '../types/gallery.js'

const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_MS = 280
const DOUBLE_TAP_DISTANCE_PX = 24

type Point = {
  x: number
  y: number
}

type Offset = {
  x: number
  y: number
}

type NaturalSize = {
  width: number
  height: number
}

type InteractionState = {
  panPointerId: number | null
  panStartPoint: Point | null
  panStartOffset: Offset
  pinchStartDistance: number
  pinchStartScale: number
  pinchStartOffset: Offset
  pointerDownPoint: Point | null
  pointerDownAt: number
  moved: boolean
  lastTapPoint: Point | null
  lastTapAt: number
}

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
    [side]: 12,
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
    top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function getStagePoint(
  clientX: number,
  clientY: number,
  stage: HTMLDivElement,
): Point {
  const rect = stage.getBoundingClientRect()
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

function getFittedImageSize(
  naturalSize: NaturalSize,
  stage: HTMLDivElement,
): NaturalSize {
  if (naturalSize.width <= 0 || naturalSize.height <= 0) {
    return {
      width: stage.clientWidth,
      height: stage.clientHeight,
    }
  }

  const widthScale = stage.clientWidth / naturalSize.width
  const heightScale = stage.clientHeight / naturalSize.height
  const fitScale = Math.min(widthScale, heightScale)

  return {
    width: naturalSize.width * fitScale,
    height: naturalSize.height * fitScale,
  }
}

function clampOffset(
  offset: Offset,
  scale: number,
  naturalSize: NaturalSize,
  stage: HTMLDivElement | null,
): Offset {
  if (!stage || scale <= 1) {
    return { x: 0, y: 0 }
  }

  const fitted = getFittedImageSize(naturalSize, stage)
  const scaledWidth = fitted.width * scale
  const scaledHeight = fitted.height * scale
  const maxX = Math.max(0, (scaledWidth - stage.clientWidth) / 2)
  const maxY = Math.max(0, (scaledHeight - stage.clientHeight) / 2)

  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  }
}

function zoomOffsetAroundPoint(
  currentOffset: Offset,
  currentScale: number,
  nextScale: number,
  anchor: Point,
  stage: HTMLDivElement,
): Offset {
  const centerX = stage.clientWidth / 2
  const centerY = stage.clientHeight / 2
  const ratio = nextScale / currentScale
  const anchorFromCenter = {
    x: anchor.x - centerX,
    y: anchor.y - centerY,
  }

  return {
    x: currentOffset.x * ratio + anchorFromCenter.x * (1 - ratio),
    y: currentOffset.y * ratio + anchorFromCenter.y * (1 - ratio),
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
  const stageRef = useRef<HTMLDivElement | null>(null)
  const activePointersRef = useRef(new Map<number, Point>())
  const interactionRef = useRef<InteractionState>({
    panPointerId: null,
    panStartPoint: null,
    panStartOffset: { x: 0, y: 0 },
    pinchStartDistance: 0,
    pinchStartScale: 1,
    pinchStartOffset: { x: 0, y: 0 },
    pointerDownPoint: null,
    pointerDownAt: 0,
    moved: false,
    lastTapPoint: null,
    lastTapAt: 0,
  })
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [naturalSize, setNaturalSize] = useState<NaturalSize>({ width: 0, height: 0 })
  const scaleRef = useRef(scale)
  const offsetRef = useRef(offset)
  const naturalSizeRef = useRef(naturalSize)

  const applyTransform = (
    nextScale: number,
    nextOffset: Offset,
  ): void => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    const clampedOffset = clampOffset(
      nextOffset,
      clampedScale,
      naturalSizeRef.current,
      stageRef.current,
    )

    scaleRef.current = clampedScale
    offsetRef.current = clampedOffset
    setScale(clampedScale)
    setOffset(clampedOffset)
  }

  const resetZoom = (): void => {
    applyTransform(1, { x: 0, y: 0 })
  }

  const toggleZoomAtPoint = (point: Point): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    if (scaleRef.current > 1) {
      resetZoom()
      return
    }

    const targetScale = 2
    const nextOffset = zoomOffsetAroundPoint(
      offsetRef.current,
      scaleRef.current,
      targetScale,
      point,
      stage,
    )

    applyTransform(targetScale, nextOffset)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndexChange])

  useEffect(() => {
    resetZoom()
    activePointersRef.current.clear()
    interactionRef.current.panPointerId = null
    interactionRef.current.panStartPoint = null
    interactionRef.current.pinchStartDistance = 0
    interactionRef.current.pointerDownPoint = null
    interactionRef.current.moved = false
  }, [index, entry?.hash])

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  useEffect(() => {
    naturalSizeRef.current = naturalSize
  }, [naturalSize])

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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const point = getStagePoint(event.clientX, event.clientY, stage)
    activePointersRef.current.set(event.pointerId, point)
    interactionRef.current.pointerDownPoint = point
    interactionRef.current.pointerDownAt = Date.now()
    interactionRef.current.moved = false

    if (activePointersRef.current.size === 1) {
      interactionRef.current.panPointerId = event.pointerId
      interactionRef.current.panStartPoint = point
      interactionRef.current.panStartOffset = offsetRef.current
    } else if (activePointersRef.current.size === 2) {
      const [first, second] = Array.from(activePointersRef.current.values())
      interactionRef.current.pinchStartDistance = distance(first, second)
      interactionRef.current.pinchStartScale = scaleRef.current
      interactionRef.current.pinchStartOffset = offsetRef.current
      interactionRef.current.panPointerId = null
      interactionRef.current.panStartPoint = null
    }

    stage.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage || !activePointersRef.current.has(event.pointerId)) {
      return
    }

    const point = getStagePoint(event.clientX, event.clientY, stage)
    activePointersRef.current.set(event.pointerId, point)

    const downPoint = interactionRef.current.pointerDownPoint
    if (downPoint && distance(point, downPoint) > 8) {
      interactionRef.current.moved = true
    }

    if (activePointersRef.current.size >= 2) {
      const [first, second] = Array.from(activePointersRef.current.values())
      const startDistance = interactionRef.current.pinchStartDistance || distance(first, second)
      const nextScale = clamp(
        interactionRef.current.pinchStartScale * (distance(first, second) / startDistance),
        MIN_SCALE,
        MAX_SCALE,
      )
      const anchor = midpoint(first, second)
      const nextOffset = zoomOffsetAroundPoint(
        interactionRef.current.pinchStartOffset,
        interactionRef.current.pinchStartScale,
        nextScale,
        anchor,
        stage,
      )
      applyTransform(nextScale, nextOffset)
      return
    }

    if (
      interactionRef.current.panPointerId === event.pointerId &&
      interactionRef.current.panStartPoint &&
      scaleRef.current > 1
    ) {
      const deltaX = point.x - interactionRef.current.panStartPoint.x
      const deltaY = point.y - interactionRef.current.panStartPoint.y

      applyTransform(scaleRef.current, {
        x: interactionRef.current.panStartOffset.x + deltaX,
        y: interactionRef.current.panStartOffset.y + deltaY,
      })
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const currentPoint = activePointersRef.current.get(event.pointerId)
    activePointersRef.current.delete(event.pointerId)
    if (stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId)
    }

    if (
      event.pointerType === 'touch' &&
      currentPoint &&
      !interactionRef.current.moved
    ) {
      const now = Date.now()
      const lastTapPoint = interactionRef.current.lastTapPoint
      const isDoubleTap = (
        now - interactionRef.current.lastTapAt <= DOUBLE_TAP_MS &&
        lastTapPoint !== null &&
        distance(currentPoint, lastTapPoint) <= DOUBLE_TAP_DISTANCE_PX
      )

      if (isDoubleTap) {
        toggleZoomAtPoint(currentPoint)
        interactionRef.current.lastTapAt = 0
        interactionRef.current.lastTapPoint = null
      } else {
        interactionRef.current.lastTapAt = now
        interactionRef.current.lastTapPoint = currentPoint
      }
    }

    if (activePointersRef.current.size === 1) {
      const [pointerId, point] = Array.from(activePointersRef.current.entries())[0]
      interactionRef.current.panPointerId = pointerId
      interactionRef.current.panStartPoint = point
      interactionRef.current.panStartOffset = offsetRef.current
      interactionRef.current.pinchStartDistance = 0
      interactionRef.current.pinchStartScale = scaleRef.current
      interactionRef.current.pinchStartOffset = offsetRef.current
    } else if (activePointersRef.current.size === 0) {
      interactionRef.current.panPointerId = null
      interactionRef.current.panStartPoint = null
      interactionRef.current.pinchStartDistance = 0
      interactionRef.current.pinchStartScale = scaleRef.current
      interactionRef.current.pinchStartOffset = offsetRef.current
    }
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    handlePointerUp(event)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    event.preventDefault()
    const point = getStagePoint(event.clientX, event.clientY, stage)
    const factor = event.deltaY < 0 ? 1.12 : 0.9
    const nextScale = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE)

    if (nextScale === scaleRef.current) {
      return
    }

    const nextOffset = zoomOffsetAroundPoint(
      offsetRef.current,
      scaleRef.current,
      nextScale,
      point,
      stage,
    )

    applyTransform(nextScale, nextOffset)
  }

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    toggleZoomAtPoint(getStagePoint(event.clientX, event.clientY, stage))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(0,0,0,0.96)',
      }}
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
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top, 0px) + 18px)',
        left: '50%',
        transform: 'translateX(-50%)',
        color: 'rgba(255,255,255,0.76)',
        fontSize: 12,
        letterSpacing: '0.05em',
        zIndex: 3,
      }}>
        {index + 1} / {items.length}
      </div>

      {/* Image stage */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)',
        paddingRight: 12,
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 108px)',
        paddingLeft: 12,
        zIndex: 1,
      }}>
        <div
          ref={stageRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            touchAction: 'none',
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
        >
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

          {url ? (
            <img
              src={url}
              alt={entry.name}
              draggable={false}
              onLoad={(event) => {
                const img = event.currentTarget
                setNaturalSize({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                })
              }}
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                objectPosition: 'center',
                userSelect: 'none',
                WebkitUserDrag: 'none',
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                transition: activePointersRef.current.size > 0 ? 'none' : 'transform 120ms ease-out',
                cursor: scale > 1 ? 'grab' : 'zoom-in',
              }}
            />
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14 }}>{entry.name}</div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '18px 22px calc(env(safe-area-inset-bottom, 0px) + 18px)',
        background: 'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.78), transparent)',
        color: '#fff',
        zIndex: 2,
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

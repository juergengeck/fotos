import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import type { GalleryEntry } from '../types/gallery.js'

const MIN_SCALE = 1
const MAX_SCALE = 20
const DOUBLE_TAP_MS = 280
const DOUBLE_TAP_DISTANCE_PX = 24
const SWIPE_NAV_THRESHOLD_PX = 56
const COMPACT_BREAKPOINT_PX = 900

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
  /** Optional content preview for the bottom bar / sidebar */
  getPreview?: (entry: T) => string | null
  /** Optional title override for the details sidebar header */
  getTitle?: (entry: T) => string | null
  /** Optional sidebar content shown in a Fotos-style details panel */
  renderSidebar?: (entry: T) => ReactNode
  /** Optional extra chrome rendered to the left of the built-in close button */
  renderTopRight?: (entry: T) => ReactNode
}

function roundChromeButtonStyle(): CSSProperties {
  return {
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
  }
}

function chromeButton(inset: 'left' | 'right'): CSSProperties {
  return {
    ...roundChromeButtonStyle(),
    position: 'absolute',
    top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
    [inset]: 16,
    zIndex: 4,
  }
}

function overlayButton(side: 'left' | 'right'): CSSProperties {
  return {
    ...roundChromeButtonStyle(),
    position: 'absolute',
    top: '50%',
    [side]: 12,
    transform: 'translateY(-50%)',
    zIndex: 4,
  }
}

function controlButtonStyle(active = false): CSSProperties {
  return {
    border: active ? '1px solid rgba(255,255,255,0.22)' : '1px solid transparent',
    background: active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.02)',
    color: active ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.48)',
    borderRadius: 12,
    padding: '10px 12px',
    minWidth: 0,
    font: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, summary, [role="button"]') !== null
  )
}

function sidebarSectionLabelStyle(): CSSProperties {
  return {
    marginBottom: 8,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
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

function centerPoint(stage: HTMLDivElement): Point {
  return {
    x: stage.clientWidth / 2,
    y: stage.clientHeight / 2,
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

function getFitScale(
  naturalSize: NaturalSize,
  stage: HTMLDivElement,
): number {
  if (naturalSize.width <= 0 || naturalSize.height <= 0) {
    return 1
  }

  const widthScale = stage.clientWidth / naturalSize.width
  const heightScale = stage.clientHeight / naturalSize.height
  return Math.min(widthScale, heightScale, 1)
}

function getFittedImageSize(
  naturalSize: NaturalSize,
  stage: HTMLDivElement,
): NaturalSize {
  const fitScale = getFitScale(naturalSize, stage)

  return {
    width: naturalSize.width > 0 ? naturalSize.width * fitScale : stage.clientWidth,
    height: naturalSize.height > 0 ? naturalSize.height * fitScale : stage.clientHeight,
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

function getActualPixelsScale(
  naturalSize: NaturalSize,
  stage: HTMLDivElement | null,
): number {
  if (!stage) {
    return 1
  }

  const fitScale = getFitScale(naturalSize, stage)
  if (fitScale <= 0) {
    return 1
  }

  return clamp(1 / fitScale, MIN_SCALE, MAX_SCALE)
}

function getActualScalePercent(
  scale: number,
  naturalSize: NaturalSize,
  stage: HTMLDivElement | null,
): number {
  if (!stage) {
    return Math.round(scale * 100)
  }

  return Math.round(scale * getFitScale(naturalSize, stage) * 100)
}

function SidebarSection({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <section>
      <div style={sidebarSectionLabelStyle()}>{label}</div>
      {children}
    </section>
  )
}

function ViewControls({
  scalePercent,
  isFit,
  isActualPixels,
  onFit,
  onActualPixels,
  onZoomOut,
  onZoomIn,
}: {
  scalePercent: number
  isFit: boolean
  isActualPixels: boolean
  onFit: () => void
  onActualPixels: () => void
  onZoomOut: () => void
  onZoomIn: () => void
}) {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        <button type="button" onClick={onFit} style={controlButtonStyle(isFit)} title="Fit image (F)">
          Fit
        </button>
        <button type="button" onClick={onActualPixels} style={controlButtonStyle(isActualPixels)} title="Actual pixels (1)">
          1:1
        </button>
        <button type="button" onClick={onZoomOut} style={controlButtonStyle()} title="Zoom out (-)">
          -
        </button>
        <button type="button" onClick={onZoomIn} style={controlButtonStyle()} title="Zoom in (+)">
          +
        </button>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: 'rgba(255,255,255,0.28)',
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {scalePercent}%
      </div>
    </>
  )
}

export function Lightbox<T extends GalleryEntry = GalleryEntry>({
  items,
  index,
  getImageUrl,
  onIndexChange,
  onClose,
  getPreview,
  getTitle,
  renderSidebar,
  renderTopRight,
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
  const [, setViewportRevision] = useState(0)
  const [compactLayout, setCompactLayout] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < COMPACT_BREAKPOINT_PX,
  )
  const hasSidebar = Boolean(renderSidebar)
  const [sidebarOpen, setSidebarOpen] = useState(() => hasSidebar && !compactLayout)

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

  const zoomBy = (factor: number, anchor?: Point): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const nextScale = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE)
    if (nextScale === scaleRef.current) {
      return
    }

    const nextOffset = zoomOffsetAroundPoint(
      offsetRef.current,
      scaleRef.current,
      nextScale,
      anchor ?? centerPoint(stage),
      stage,
    )

    applyTransform(nextScale, nextOffset)
  }

  const zoomToActualPixels = (): void => {
    const nextScale = getActualPixelsScale(naturalSizeRef.current, stageRef.current)
    applyTransform(nextScale, { x: 0, y: 0 })
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

    const targetScale = clamp(2, MIN_SCALE, MAX_SCALE)
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
    if (typeof window === 'undefined') {
      return
    }

    const updateLayout = () => {
      setCompactLayout(window.innerWidth < COMPACT_BREAKPOINT_PX)
      setViewportRevision(version => version + 1)
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [])

  useEffect(() => {
    if (!hasSidebar) {
      setSidebarOpen(false)
      return
    }

    if (compactLayout) {
      setSidebarOpen(false)
    } else {
      setSidebarOpen(true)
    }
  }, [compactLayout, hasSidebar])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') {
      return
    }

    let frame = 0
    const syncViewport = () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }

      frame = window.requestAnimationFrame(() => {
        setViewportRevision(version => version + 1)
        if (scaleRef.current <= 1) {
          return
        }

        const nextOffset = clampOffset(
          offsetRef.current,
          scaleRef.current,
          naturalSizeRef.current,
          stage,
        )

        if (nextOffset.x !== offsetRef.current.x || nextOffset.y !== offsetRef.current.y) {
          offsetRef.current = nextOffset
          setOffset(nextOffset)
        }
      })
    }

    const observer = new ResizeObserver(syncViewport)
    observer.observe(stage)
    syncViewport()

    return () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }

      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (event.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
      if (event.key === 'f' || event.key === 'F') resetZoom()
      if (event.key === '1') zoomToActualPixels()
      if (event.key === '-' || event.key === '_') zoomBy(0.85)
      if (event.key === '+' || event.key === '=') zoomBy(1.18)
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
  const title = getTitle?.(entry) ?? entry.name
  const timestamp = new Date(entry.timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const actualScale = getActualPixelsScale(naturalSize, stageRef.current)
  const scalePercent = getActualScalePercent(scale, naturalSize, stageRef.current)
  const sidebarVisible = hasSidebar && sidebarOpen
  const showFloatingControls = compactLayout || !sidebarVisible
  const stageBottomPadding = hasSidebar
    ? (showFloatingControls
      ? 'calc(env(safe-area-inset-bottom, 0px) + 92px)'
      : 'calc(env(safe-area-inset-bottom, 0px) + 28px)')
    : 'calc(env(safe-area-inset-bottom, 0px) + 108px)'

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage || isInteractiveTarget(event.target)) {
      return
    }

    const point = getStagePoint(event.clientX, event.clientY, stage)
    activePointersRef.current.set(event.pointerId, point)
    interactionRef.current.pointerDownPoint = point
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
    if (!stage || !activePointersRef.current.has(event.pointerId)) {
      return
    }

    const currentPoint = activePointersRef.current.get(event.pointerId)
    const downPoint = interactionRef.current.pointerDownPoint
    activePointersRef.current.delete(event.pointerId)
    if (stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId)
    }

    if (
      event.pointerType === 'touch' &&
      currentPoint &&
      downPoint &&
      interactionRef.current.moved &&
      scaleRef.current === 1
    ) {
      const dx = currentPoint.x - downPoint.x
      const dy = currentPoint.y - downPoint.y

      if (
        Math.abs(dx) >= SWIPE_NAV_THRESHOLD_PX &&
        Math.abs(dx) > Math.abs(dy) * 1.15
      ) {
        if (dx < 0 && canNext) {
          onIndexChange(index + 1)
        } else if (dx > 0 && canPrev) {
          onIndexChange(index - 1)
        }

        interactionRef.current.lastTapAt = 0
        interactionRef.current.lastTapPoint = null
      }
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
      interactionRef.current.pointerDownPoint = null
    }
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    handlePointerUp(event)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage || isInteractiveTarget(event.target)) {
      return
    }

    event.preventDefault()
    const point = getStagePoint(event.clientX, event.clientY, stage)
    const factor = event.deltaY < 0 ? 1.12 : 0.9
    zoomBy(factor, point)
  }

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage || isInteractiveTarget(event.target)) {
      return
    }

    toggleZoomAtPoint(getStagePoint(event.clientX, event.clientY, stage))
  }

  const handleStageClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (
      !stage ||
      isInteractiveTarget(event.target) ||
      interactionRef.current.moved ||
      scaleRef.current > 1 ||
      event.detail > 1
    ) {
      return
    }

    const point = getStagePoint(event.clientX, event.clientY, stage)
    const third = stage.clientWidth / 3

    if (point.x < third && canPrev) {
      onIndexChange(index - 1)
    } else if (point.x > third * 2 && canNext) {
      onIndexChange(index + 1)
    }
  }

  const sidebarContent = hasSidebar ? (
    <>
      <div
        style={{
          padding: '12px 14px 11px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.92)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 10,
            color: 'rgba(255,255,255,0.28)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {index + 1} of {items.length}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {preview && (
          <SidebarSection label="Message">
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                color: 'rgba(255,255,255,0.78)',
              }}
            >
              {preview}
            </div>
          </SidebarSection>
        )}
        {!compactLayout && (
          <SidebarSection label="View">
            <ViewControls
              scalePercent={scalePercent}
              isFit={scale === 1}
              isActualPixels={Math.abs(scale - actualScale) < 0.01}
              onFit={resetZoom}
              onActualPixels={zoomToActualPixels}
              onZoomOut={() => zoomBy(0.85)}
              onZoomIn={() => zoomBy(1.18)}
            />
          </SidebarSection>
        )}
        {renderSidebar?.(entry)}
      </div>
    </>
  ) : null

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
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
        }}
      >
        <div
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
          }}
        >
          {url && (
            <a href={url} download={entry.name} style={chromeButton('left')} aria-label={`Download ${entry.name}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>
          )}

          <div
            style={{
              position: 'absolute',
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              right: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              zIndex: 4,
            }}
          >
            {renderTopRight?.(entry)}
            {hasSidebar && (
              <button
                type="button"
                onClick={() => setSidebarOpen(open => !open)}
                aria-label={sidebarVisible ? 'Hide details' : 'Show details'}
                title={sidebarVisible ? 'Hide details' : 'Show details'}
                style={roundChromeButtonStyle()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 10v5" />
                  <circle cx="12" cy="7" r="0.8" fill="currentColor" stroke="none" />
                </svg>
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" style={roundChromeButtonStyle()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div
            style={{
              position: 'absolute',
              top: 'calc(env(safe-area-inset-top, 0px) + 18px)',
              left: '50%',
              transform: 'translateX(-50%)',
              color: 'rgba(255,255,255,0.76)',
              fontSize: 12,
              letterSpacing: '0.05em',
              zIndex: 3,
            }}
          >
            {index + 1} / {items.length}
          </div>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'center',
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)',
              paddingRight: 12,
              paddingBottom: stageBottomPadding,
              paddingLeft: 12,
              zIndex: 1,
            }}
          >
            <div
              ref={stageRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onWheel={handleWheel}
              onDoubleClick={handleDoubleClick}
              onClick={handleStageClick}
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
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onIndexChange(index - 1)
                  }}
                  aria-label="Previous"
                  style={overlayButton('left')}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
              )}
              {canNext && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onIndexChange(index + 1)
                  }}
                  aria-label="Next"
                  style={overlayButton('right')}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              )}

              {url ? (
                <img
                  src={url}
                  alt={entry.name}
                  draggable={false}
                  onLoad={(event) => {
                    const image = event.currentTarget
                    setNaturalSize({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
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

          {showFloatingControls && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                zIndex: 4,
                width: 178,
                maxWidth: 'calc(100vw - 32px)',
                padding: 10,
                borderRadius: 18,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(0,0,0,0.72)',
                backdropFilter: 'blur(16px)',
              }}
            >
              <ViewControls
                scalePercent={scalePercent}
                isFit={scale === 1}
                isActualPixels={Math.abs(scale - actualScale) < 0.01}
                onFit={resetZoom}
                onActualPixels={zoomToActualPixels}
                onZoomOut={() => zoomBy(0.85)}
                onZoomIn={() => zoomBy(1.18)}
              />
            </div>
          )}

          {!hasSidebar && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '18px 22px calc(env(safe-area-inset-bottom, 0px) + 18px)',
                background: 'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.78), transparent)',
                color: '#fff',
                zIndex: 2,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', marginBottom: preview ? 6 : 0 }}>
                {entry.senderName && <div style={{ fontSize: 16, fontWeight: 700 }}>{entry.senderName}</div>}
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)' }}>{timestamp}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)' }}>{title}</div>
              </div>
              {preview && (
                <div style={{ maxWidth: 720, fontSize: 13, color: 'rgba(255,255,255,0.84)', lineHeight: 1.55 }}>
                  {preview}
                </div>
              )}
            </div>
          )}

          {compactLayout && sidebarVisible && (
            <aside
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)',
                maxHeight: 'min(42vh, 360px)',
                display: 'flex',
                flexDirection: 'column',
                background: '#0d0d0d',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 20,
                overflow: 'hidden',
                boxShadow: '0 20px 48px rgba(0,0,0,0.42)',
                zIndex: 4,
              }}
            >
              {sidebarContent}
            </aside>
          )}
        </div>

        {!compactLayout && sidebarVisible && (
          <aside
            style={{
              width: 320,
              maxWidth: 'min(34vw, 360px)',
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              background: '#0d0d0d',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
              flexShrink: 0,
            }}
          >
            {sidebarContent}
          </aside>
        )}
      </div>
    </div>
  )
}

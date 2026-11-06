/**
 * Gallery types — shared across fotos, vger chat, and glue feed.
 *
 * GalleryEntry is the minimal shape. Domain-specific consumers extend it
 * with their own fields (exif, faces, semantic for fotos; messageId for chat).
 */

/** Minimal gallery entry — any image with a hash, name, and timestamp */
export interface GalleryEntry {
  hash: string
  name: string
  mimeType?: string
  timestamp: number
  senderName?: string
}

/** Day group for gallery grid */
export interface DayGroup<T extends GalleryEntry = GalleryEntry> {
  date: string
  items: T[]
}

/** Lightbox state */
export interface LightboxState {
  index: number | null
  items: GalleryEntry[]
}

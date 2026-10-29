// Types
export type { GalleryEntry, DayGroup, LightboxState } from './types/gallery.js'

// Lib
export { groupByDay, flattenGroups, formatDayLabel, entryDate } from './lib/grouping.js'

// Components
export { GalleryGrid, type GalleryGridProps } from './components/GalleryGrid.js'
export { Lightbox, type LightboxProps } from './components/Lightbox.js'

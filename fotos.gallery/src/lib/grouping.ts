import type { GalleryEntry, DayGroup } from '../types/gallery.js'

/** Extract YYYY-MM-DD from a timestamp */
export function entryDate(entry: GalleryEntry): string {
  return new Date(entry.timestamp).toISOString().slice(0, 10)
}

/** Group entries by capture day (assumes entries are sorted newest-first) */
export function groupByDay<T extends GalleryEntry>(entries: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  let currentDate = ''
  let currentItems: T[] = []

  for (const entry of entries) {
    const date = entryDate(entry)
    if (date !== currentDate) {
      if (currentItems.length > 0) {
        groups.push({ date: currentDate, items: currentItems })
      }
      currentDate = date
      currentItems = [entry]
    } else {
      currentItems.push(entry)
    }
  }

  if (currentItems.length > 0) {
    groups.push({ date: currentDate, items: currentItems })
  }

  return groups
}

/** Flatten day groups back to a flat array */
export function flattenGroups<T extends GalleryEntry>(groups: DayGroup<T>[]): T[] {
  return groups.flatMap(g => g.items)
}

/** Format YYYY-MM-DD as human-readable label */
export function formatDayLabel(dateStr: string): string {
  const day = new Date(`${dateStr}T00:00:00`)
  const now = new Date()
  const diff = Math.floor((now.getTime() - day.getTime()) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'yesterday'
  return day.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: day.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  }).toLowerCase()
}

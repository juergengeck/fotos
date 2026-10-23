import type { GalleryEntry, DayGroup } from '../types/gallery.js'

function toDateKey(year: string | number, month: string | number, day: string | number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>()

function getDateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateKeyFormatters.get(timeZone)
  if (cached) {
    return cached
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  dateKeyFormatters.set(timeZone, formatter)
  return formatter
}

function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = getDateKeyFormatter(timeZone).formatToParts(date)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error(`Failed to build gallery day key for time zone ${timeZone}`)
  }

  return toDateKey(year, month, day)
}

/** Extract YYYY-MM-DD from a timestamp using the user's local calendar day by default. */
export function entryDate(entry: GalleryEntry, timeZone?: string): string {
  const date = new Date(entry.timestamp)
  if (timeZone) {
    return formatDateKeyInTimeZone(date, timeZone)
  }
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** Group entries by capture day (assumes entries are sorted newest-first) */
export function groupByDay<T extends GalleryEntry>(entries: T[], timeZone?: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  let currentDate = ''
  let currentItems: T[] = []

  for (const entry of entries) {
    const date = entryDate(entry, timeZone)
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
  const todayKey = toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
  if (dateStr === todayKey) return 'today'

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = toDateKey(
    yesterday.getFullYear(),
    yesterday.getMonth() + 1,
    yesterday.getDate(),
  )
  if (dateStr === yesterdayKey) return 'yesterday'

  return day.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: day.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  }).toLowerCase()
}

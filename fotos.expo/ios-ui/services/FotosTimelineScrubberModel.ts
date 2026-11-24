export type FotosTimelineRowDescriptor =
  | { kind: 'day'; label: string; shortLabel: string }
  | { kind: 'photos' };

export interface FotosTimelineSection {
  label: string;
  shortLabel: string;
  top: number;
  ratio: number;
  rowIndex: number;
}

export interface FotosTimelineTick {
  key: string;
  label: string;
  ratio: number;
}

export interface FotosTimelineLayout {
  totalHeight: number;
  maxScroll: number;
  sections: FotosTimelineSection[];
  ticks: FotosTimelineTick[];
  firstShortLabel?: string;
  lastShortLabel?: string;
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function buildFotosTimelineLayout(options: {
  rows: readonly FotosTimelineRowDescriptor[];
  dayRowHeight: number;
  photoRowHeight: number;
  viewportHeight: number;
  paddingTop?: number;
  paddingBottom?: number;
  maxTicks?: number;
}): FotosTimelineLayout {
  const {
    rows,
    dayRowHeight,
    photoRowHeight,
    viewportHeight,
    paddingTop = 0,
    paddingBottom = 18,
    maxTicks = 44,
  } = options;

  let offset = paddingTop;
  const rawSections: Array<{ label: string; shortLabel: string; top: number; rowIndex: number }> = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.kind === 'day') {
      rawSections.push({
        label: row.label,
        shortLabel: row.shortLabel,
        top: offset,
        rowIndex: index,
      });
      offset += dayRowHeight;
    } else {
      offset += photoRowHeight;
    }
  }

  const totalHeight = offset + paddingBottom;
  const maxScroll = Math.max(0, totalHeight - Math.max(0, viewportHeight));

  const sections: FotosTimelineSection[] = rawSections.map((section) => ({
    ...section,
    ratio: maxScroll > 0 ? clampUnit(section.top / maxScroll) : 0,
  }));

  const ticks = sampleTimelineTicks(sections, maxTicks);
  const firstShortLabel = sections[0]?.shortLabel;
  const lastShortLabel = sections.length > 1 ? sections[sections.length - 1]?.shortLabel : undefined;

  return {
    totalHeight,
    maxScroll,
    sections,
    ticks,
    firstShortLabel,
    lastShortLabel: lastShortLabel !== firstShortLabel ? lastShortLabel : undefined,
  };
}

function sampleTimelineTicks(sections: readonly FotosTimelineSection[], maxTicks: number): FotosTimelineTick[] {
  if (sections.length === 0) return [];
  if (sections.length <= maxTicks) {
    return sections.map((section) => ({
      key: `${section.rowIndex}:${section.label}`,
      label: section.label,
      ratio: section.ratio,
    }));
  }

  const minDelta = 1 / Math.max(2, maxTicks - 1);
  const ticks: FotosTimelineTick[] = [];
  let lastRatio = -Infinity;

  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const isLast = index === sections.length - 1;
    if (index === 0 || isLast || section.ratio - lastRatio >= minDelta) {
      ticks.push({
        key: `${section.rowIndex}:${section.label}`,
        label: section.label,
        ratio: section.ratio,
      });
      lastRatio = section.ratio;
    }
  }
  return ticks;
}

export function resolveActiveTimelineSection(
  sections: readonly FotosTimelineSection[],
  scrollOffset: number,
  threshold = 28,
): FotosTimelineSection | undefined {
  if (sections.length === 0) return undefined;
  let active = sections[0];
  for (const section of sections) {
    if (section.top > scrollOffset + threshold) break;
    active = section;
  }
  return active;
}

export function resolveTimelineSectionAtRatio(
  sections: readonly FotosTimelineSection[],
  ratio: number,
): FotosTimelineSection | undefined {
  if (sections.length === 0) return undefined;
  const clamped = clampUnit(ratio);
  let active = sections[0];
  for (const section of sections) {
    if (section.ratio > clamped + 0.002) break;
    active = section;
  }
  return active;
}

export function computeDockTopOffset(trackHeight: number, dockHeight: number, ratio: number): number {
  const travel = Math.max(0, trackHeight - dockHeight);
  return travel * clampUnit(ratio);
}

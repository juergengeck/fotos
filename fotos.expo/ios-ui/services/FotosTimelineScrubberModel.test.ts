import { describe, expect, it } from 'vitest';
import {
  buildFotosTimelineLayout,
  computeDockTopOffset,
  resolveActiveTimelineSection,
  resolveTimelineSectionAtRatio,
  type FotosTimelineRowDescriptor,
} from './FotosTimelineScrubberModel';

describe('FotosTimelineScrubberModel', () => {
  it('computes day section ratios and active section across scrolling', () => {
    const rows: FotosTimelineRowDescriptor[] = [
      { kind: 'day', label: '23 November 2026', shortLabel: '23 Nov' },
      { kind: 'photos' },
      { kind: 'photos' },
      { kind: 'day', label: '22 November 2026', shortLabel: '22 Nov' },
      { kind: 'photos' },
      { kind: 'day', label: '10 October 2026', shortLabel: '10 Oct' },
      { kind: 'photos' },
      { kind: 'photos' },
      { kind: 'photos' },
    ];

    const layout = buildFotosTimelineLayout({
      rows,
      dayRowHeight: 44,
      photoRowHeight: 120,
      viewportHeight: 400,
      paddingBottom: 18,
    });

    // 3 day rows (132) + 6 photo rows (720) + 18 = 870; maxScroll = 470
    expect(layout.totalHeight).toBe(870);
    expect(layout.maxScroll).toBe(470);
    expect(layout.sections).toHaveLength(3);
    expect(layout.sections[0].top).toBe(0);
    expect(layout.sections[0].ratio).toBe(0);
    expect(layout.sections[1].top).toBe(284); // 44 + 240
    expect(layout.sections[1].ratio).toBeCloseTo(284 / 470, 4);
    expect(layout.sections[2].top).toBe(448); // 284 + 44 + 120
    expect(layout.firstShortLabel).toBe('23 Nov');
    expect(layout.lastShortLabel).toBe('10 Oct');

    expect(resolveActiveTimelineSection(layout.sections, 0)?.label).toBe('23 November 2026');
    expect(resolveActiveTimelineSection(layout.sections, 270)?.label).toBe('22 November 2026');
    expect(resolveActiveTimelineSection(layout.sections, 450)?.label).toBe('10 October 2026');
    expect(resolveTimelineSectionAtRatio(layout.sections, 0.98)?.label).toBe('10 October 2026');
  });

  it('caps rendered ticks for large multi-year libraries while keeping endpoints', () => {
    const rows: FotosTimelineRowDescriptor[] = [];
    for (let day = 0; day < 200; day++) {
      rows.push({ kind: 'day', label: `Day ${day}`, shortLabel: `D${day}` });
      rows.push({ kind: 'photos' });
    }

    const layout = buildFotosTimelineLayout({
      rows,
      dayRowHeight: 44,
      photoRowHeight: 120,
      viewportHeight: 600,
      maxTicks: 24,
    });

    expect(layout.sections).toHaveLength(200);
    expect(layout.ticks.length).toBeLessThanOrEqual(25);
    expect(layout.ticks[0].label).toBe('Day 0');
    expect(layout.ticks[layout.ticks.length - 1].label).toBe('Day 199');
  });

  it('clamps dock offset within track bounds', () => {
    expect(computeDockTopOffset(500, 180, -0.5)).toBe(0);
    expect(computeDockTopOffset(500, 180, 0.5)).toBe(160);
    expect(computeDockTopOffset(500, 180, 2)).toBe(320);
    expect(computeDockTopOffset(100, 180, 1)).toBe(0);
  });
});

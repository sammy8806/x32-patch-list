import { describe, expect, test } from 'bun:test';

import {
  computeSegments,
  gapKey,
  DEFAULT_THRESHOLDS,
  type Segment,
} from '../src/components/table-segments.js';

// Sugar: "data" = non-null, "gap" = null. Build an array like [1, null, null, 2].
const D = (n: number) => n;
const G = null;

describe('computeSegments', () => {
  test('empty input produces no segments', () => {
    expect(computeSegments([])).toEqual([]);
  });

  test('all data rows produce a single data segment', () => {
    const rows = [D(1), D(2), D(3)];
    const segments = computeSegments(rows);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: 'data', start: 0, rows: [1, 2, 3] });
  });

  test('all empty rows produce a trailing gap', () => {
    const rows = [G, G, G, G];
    const segments = computeSegments(rows);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'gap',
      position: 'trailing',
      start: 0,
      end: 3,
      count: 4,
      collapsible: true, // count 4 >= trailing threshold 3
    });
  });

  test('trailing gap below threshold is not collapsible', () => {
    // trailing threshold is 3, so 2 trailing empty rows must NOT collapse
    const rows = [D(1), D(2), G, G];
    const segments = computeSegments(rows);
    expect(segments).toHaveLength(2);
    expect(segments[1]).toMatchObject({
      kind: 'gap',
      position: 'trailing',
      count: 2,
      collapsible: false,
    });
  });

  test('trailing gap at threshold boundary is collapsible', () => {
    const rows = [D(1), G, G, G];
    const segments = computeSegments(rows);
    expect(segments[1]).toMatchObject({
      kind: 'gap',
      position: 'trailing',
      count: 3,
      collapsible: true,
    });
  });

  test('middle gap below threshold is not collapsible', () => {
    // middle threshold is 6; a 5-row middle gap must NOT collapse
    const rows = [D(1), G, G, G, G, G, D(2)];
    const segments = computeSegments(rows);
    expect(segments).toHaveLength(3);
    expect(segments[1]).toMatchObject({
      kind: 'gap',
      position: 'middle',
      count: 5,
      collapsible: false,
    });
  });

  test('middle gap at threshold boundary is collapsible', () => {
    const rows = [D(1), G, G, G, G, G, G, D(2)];
    const segments = computeSegments(rows);
    expect(segments[1]).toMatchObject({
      kind: 'gap',
      position: 'middle',
      count: 6,
      collapsible: true,
    });
  });

  test('mixed table reproduces the Local Input screenshot layout', () => {
    // rows 1-2 data, 3-10 empty (8), 11-12 data, 13-14 empty (2),
    // 15-16 data, 17-32 empty (16 trailing)
    const rows: Array<number | null> = [
      D(1), D(2),
      G, G, G, G, G, G, G, G, // 8-row middle gap
      D(11), D(12),
      G, G, // 2-row middle gap (NOT collapsible)
      D(15), D(16),
      G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, // 16-row trailing gap
    ];
    const segments = computeSegments(rows);
    // 4 data segments interleaved with 3 gap segments → 7 total? No:
    // data, gap(8, middle, collapsible), data, gap(2, middle, not), data, gap(16, trailing, collapsible)
    expect(segments.map((s) => s.kind)).toEqual([
      'data', 'gap', 'data', 'gap', 'data', 'gap',
    ]);
    const gaps = segments.filter((s): s is Extract<Segment<number | null>, { kind: 'gap' }> => s.kind === 'gap');
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toMatchObject({ count: 8, position: 'middle', collapsible: true });
    expect(gaps[1]).toMatchObject({ count: 2, position: 'middle', collapsible: false });
    expect(gaps[2]).toMatchObject({ count: 16, position: 'trailing', collapsible: true });
  });

  test('leading gap is treated as middle (data follows)', () => {
    const rows = [G, G, G, G, G, G, D(7)];
    const segments = computeSegments(rows);
    expect(segments[0]).toMatchObject({
      kind: 'gap',
      position: 'middle',
      count: 6,
      collapsible: true,
    });
  });

  test('custom thresholds override defaults', () => {
    const rows = [D(1), G, G, D(4)];
    const segments = computeSegments(rows, { trailing: 1, middle: 2 });
    expect(segments[1]).toMatchObject({
      kind: 'gap',
      position: 'middle',
      count: 2,
      collapsible: true,
    });
  });

  test('DEFAULT_THRESHOLDS matches spec', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ trailing: 3, middle: 6 });
  });
});

describe('gapKey', () => {
  test('encodes variant, patchType, and gap start', () => {
    const rows = [D(1), D(2), G, G, G, G, G, G];
    const segments = computeSegments(rows);
    const gap = segments[1]!;
    if (gap.kind !== 'gap') throw new Error('unreachable');
    expect(gapKey('input', 'in', gap)).toBe('input:in:gap:2');
  });
});

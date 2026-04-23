/**
 * Pure helpers for grouping patch-table rows into rendered "segments".
 *
 * Given a row array where each element is either data (truthy) or empty
 * (`null` / `undefined`), produces an ordered list of:
 *   - data segments — one or more consecutive non-empty rows
 *   - gap segments — one or more consecutive empty rows, tagged as
 *     `middle` (bounded by data on both sides, or at the start of the
 *     table with data after) or `trailing` (extends to the last row)
 *
 * Gap segments record whether they meet the "should collapse" threshold;
 * the render layer then looks up the user's explicit collapse override
 * and renders a collapse bar vs. the empty rows accordingly.
 */

export type Segment<T> =
  | { kind: 'data'; start: number; rows: T[] }
  | {
      kind: 'gap';
      /** Inclusive start index in the source row array. */
      start: number;
      /** Inclusive end index in the source row array. */
      end: number;
      /** Number of consecutive empty rows. */
      count: number;
      position: 'middle' | 'trailing';
      /** Whether this gap meets the collapse threshold. */
      collapsible: boolean;
    };

export interface SegmentThresholds {
  /** Minimum consecutive empty rows required to collapse a trailing gap. */
  trailing: number;
  /** Minimum consecutive empty rows required to collapse a middle gap. */
  middle: number;
}

export const DEFAULT_THRESHOLDS: SegmentThresholds = {
  trailing: 3,
  middle: 6,
};

/**
 * Split `rows` into data / gap segments.
 *
 * A row is "empty" iff `isEmpty(row)` returns true. Default is `row == null`,
 * which matches the shape of `getChannelListForType` and `getOutputListForType`.
 */
export function computeSegments<T>(
  rows: readonly T[],
  thresholds: SegmentThresholds = DEFAULT_THRESHOLDS,
  isEmpty: (row: T) => boolean = (row) => row == null,
): Segment<T>[] {
  const segments: Segment<T>[] = [];
  let i = 0;

  while (i < rows.length) {
    if (isEmpty(rows[i]!)) {
      let j = i;
      while (j < rows.length && isEmpty(rows[j]!)) j += 1;
      const trailing = j === rows.length;
      const count = j - i;
      const threshold = trailing ? thresholds.trailing : thresholds.middle;
      segments.push({
        kind: 'gap',
        start: i,
        end: j - 1,
        count,
        position: trailing ? 'trailing' : 'middle',
        collapsible: count >= threshold,
      });
      i = j;
    } else {
      const start = i;
      const dataRows: T[] = [];
      while (i < rows.length && !isEmpty(rows[i]!)) {
        dataRows.push(rows[i]!);
        i += 1;
      }
      segments.push({ kind: 'data', start, rows: dataRows });
    }
  }

  return segments;
}

/**
 * Build a deterministic key for a gap segment so per-gap collapse state
 * can be persisted.
 */
export function gapKey(
  variant: string,
  patchType: string,
  gap: Extract<Segment<unknown>, { kind: 'gap' }>,
): string {
  return `${variant}:${patchType}:gap:${gap.start}`;
}

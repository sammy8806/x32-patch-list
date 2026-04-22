/**
 * Source-index mapping helpers.
 *
 * X32 scene files encode routed sources as integers whose meaning depends on
 * whether the context is an input channel, an output channel, or a user route.
 * These functions are direct ports of the `GetRouteKeyFromSource` /
 * `GetChannelKeyFromSource` / `GetUserRouteSource` / `GetUserRouteKey` /
 * `GetNameForOutput` helpers in `legacy/x32parser.py`.
 */

const pad2 = (n: number | string): string => String(n).padStart(2, '0');

/** Convert an input-channel source integer to a route key. */
export function getRouteKeyFromSource(source: number): string | null {
  if (source === 0) return 'off';
  if (source <= 32) return `in.${pad2(source)}`;
  if (source <= 40) return `in.${pad2(source)}`;
  if (source <= 48) return `fx.${pad2(source - 40)}`;
  if (source <= 64) return `bus.${pad2(source - 48)}`;
  return null;
}

/** Convert an output-channel source integer to a channel key. */
export function getChannelKeyFromSource(source: number): string | null {
  if (source === 0) return null;
  if (source === 1) return 'main.l';
  if (source === 2) return 'main.r';
  if (source === 3) return 'main.m';
  if (source <= 19) return `bus.${pad2(source - 3)}`;
  if (source <= 25) return `mtx.${pad2(source - 19)}`;
  if (source <= 57) return `in.${pad2(source - 25)}`;
  if (source <= 65) return `auxin.${pad2(source - 57)}`;
  if (source <= 73) return `fx.${pad2(source - 65)}`;
  if (source === 74) return 'mon.l';
  if (source === 75) return 'mon.r';
  if (source === 76) return 'tb';
  return null;
}

/** Map a user-routing source integer to a source key. */
export function getUserRouteSource(
  routingType: 'in' | 'out',
  source: number,
): string | null {
  if (source === 0) return null;
  if (source <= 32) return `in.${pad2(source)}`;
  if (source <= 80) return `aes50a.${pad2(source - 32)}`;
  if (source <= 128) return `aes50b.${pad2(source - 80)}`;
  if (source <= 160) return `card.${pad2(source - 128)}`;
  if (source <= 166) return `auxin.${pad2(source - 160)}`;
  if (source <= 168) return 'tb';
  if (routingType !== 'out') return null;
  if (source <= 184) return `out.${pad2(source - 168)}`;
  if (source <= 200) return `p16.${pad2(source - 184)}`;
  if (source <= 206) return `aux.${pad2(source - 200)}`;
  if (source === 207) return 'mon.l';
  if (source === 208) return 'mon.r';
  return null;
}

/** Resolve the explicit user-route slot selected by a UIN/UOUT group token. */
export function getUserRouteKey(group: string, offset: number): string | null {
  const match = group.match(/^(UOUT|UIN)([0-9][0-9]?)?/);
  if (!match) return null;
  const [, routeType, startStr] = match;
  const start = startStr ? parseInt(startStr, 10) : 0;
  const kind = routeType === 'UOUT' ? 'out' : 'in';
  return `user-${kind}.${pad2(offset + start)}`;
}

/** Human-readable name for a physical output type and number. */
export function getNameForOutput(chType: string, chNum: number | string): string {
  switch (chType) {
    case 'aux':
      return `Aux ${chNum}`;
    case 'main':
      return `Output ${chNum}`;
    case 'aes':
      return chNum === 1 || chNum === '1' ? 'AES Left' : 'AES Right';
    case 'p16':
      return `P16 ${chNum}`;
    default:
      return '';
  }
}

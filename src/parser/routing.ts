/**
 * Route-group decoding.
 *
 * X32 routing blocks are declared in strings like `AN1-8` / `A1-8` / `UIN1-8`
 * / `AUX/CR` / `AUX/TB`. These functions translate those tokens plus an offset
 * into internal source keys and human-readable names.
 *
 * Ports `RouteSourceFromRouteGroup` and `NameFromRouteGroup` from
 * `legacy/x32parser.py`.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

const ROUTE_GROUP_SOURCE_RE =
  /^(AN|OUT|CARD|P16|AUX\/CR|AUX\/TB|AUX|A|B|UOUT|UIN)([0-9][0-9]?)?/;

const ROUTE_GROUP_NAME_RE = /^(AUX|AN|A|B|OUT|CARD|P16|UIN|UOUT)([0-9][0-9]?)?/;

/**
 * Resolve a route-group token and offset to an internal source key.
 * Returns `null` when the group is unknown or blocked out.
 */
export function routeSourceFromRouteGroup(
  group: string,
  offset: number,
  userRouting: Record<string, string | null>,
): string | null {
  const match = group.match(ROUTE_GROUP_SOURCE_RE);
  if (!match) return null;
  const [, src, nStr] = match;
  const n = nStr ? parseInt(nStr, 10) : 0;

  switch (src) {
    case 'AUX/CR':
      if (offset < 6) return `aux.${pad2(offset + 1)}`;
      if (offset === 6) return 'mon.l';
      if (offset === 7) return 'mon.r';
      return null;
    case 'AUX/TB':
      if (offset < 6) return `auxin.${pad2(offset + 1)}`;
      if (offset === 6) return 'tb';
      return null;
    case 'AUX':
      return `in.${pad2(offset + 33)}`;
    case 'AN':
      return `in.${pad2(offset + n)}`;
    case 'A':
      return `aes50a.${pad2(offset + n)}`;
    case 'B':
      return `aes50b.${pad2(offset + n)}`;
    case 'OUT':
      return `out.${pad2(offset + n)}`;
    case 'CARD':
      return `card.${pad2(offset + n)}`;
    case 'P16':
      return `p16.${pad2(offset + n)}`;
    case 'UIN': {
      const key = `user-in.${pad2(offset + n)}`;
      return key in userRouting ? userRouting[key] : null;
    }
    case 'UOUT': {
      const key = `user-out.${pad2(offset + n)}`;
      return key in userRouting ? userRouting[key] : null;
    }
    default:
      return null;
  }
}

/** Human-readable label for a route group slot. */
export function nameFromRouteGroup(group: string, offset: number): string {
  const match = group.match(ROUTE_GROUP_NAME_RE);
  if (!match) return '';
  const [, src, nStr] = match;
  const n = nStr ? parseInt(nStr, 10) : 0;

  switch (src) {
    case 'AN':
      return `Local ${pad2(offset + n)}`;
    case 'A':
      return `AES50-A ${pad2(offset + n)}`;
    case 'B':
      return `AES50-B ${pad2(offset + n)}`;
    case 'OUT':
      return `Output ${pad2(offset + n)}`;
    case 'CARD':
      return `Card ${pad2(offset + n)}`;
    case 'P16':
      return `P-16 ${pad2(offset + n)}`;
    case 'UIN':
      return `User In ${pad2(offset + n)}`;
    case 'UOUT':
      return `User Out ${pad2(offset + n)}`;
    default:
      break;
  }

  if (group.startsWith('AUX/CR')) {
    if (offset < 6) return `Aux Out ${pad2(offset + 1)}`;
    if (offset === 6) return 'Control Room Left';
    if (offset === 7) return 'Control Room Right';
  } else if (group.startsWith('AUX/TB')) {
    if (offset < 6) return `Aux In ${pad2(offset + 1)}`;
    if (offset === 6) return 'Talkback';
  } else if (group.startsWith('AUX1-4')) {
    if (offset < 6) return `Aux In ${pad2(offset + 1)}`;
    if (offset === 6) return 'USB L';
    if (offset === 7) return 'USB R';
  }

  return '';
}

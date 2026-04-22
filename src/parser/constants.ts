/**
 * Constants ported from main.py and x32parser.py.
 *
 * Keep these as the single source of truth. UI code should import from here
 * rather than re-declaring any of them.
 */

/** Human-readable labels for input/output types. */
export const TYPE_NAMES: Record<string, string> = {
  in: 'Local',
  aux: 'Aux',
  aes: 'AES/EBU',
  aes50a: 'AES50-A',
  aes50b: 'AES50-B',
  card: 'Card',
  p16: 'Ultranet',
  out: 'Local',
  mtx: 'Matrix',
  'user-in': 'User In',
  'user-out': 'User Out',
};

/** Labels for mix-style channel prefixes. */
export const MIX_NAMES: Record<string, string> = {
  bus: 'Bus',
  main: 'Main',
  fxrtn: 'FX',
  mtx: 'Matrix',
};

/** Labels for non-mix channel prefixes. */
export const CHANNEL_NAMES: Record<string, string> = {
  auxin: 'Aux',
};

export const OUTPUT_CONFIG_TYPES = ['bus', 'mtx', 'main'] as const;
export const INPUT_CONFIG_TYPES = ['ch', 'auxin'] as const;

/** Max number of channels per input type. */
export const MAX_CHANNELS: Record<string, number> = {
  aes50a: 48,
  aes50b: 48,
  'user-in': 32,
  in: 40,
  card: 32,
};

/** Max number of output slots per output type. */
export const MAX_OUTPUTS: Record<string, number> = {
  aes50a: 48,
  aes50b: 48,
  'user-out': 48,
  card: 32,
  out: 16,
  p16: 16,
  aux: 6,
  aes: 2,
};

/** Input types shown in the input patch list, in display order. */
export const INPUT_TABLE_TYPES = ['in', 'aes50a', 'aes50b', 'card'] as const;

/** Output types shown in the output patch list, in display order. */
export const OUTPUT_TABLE_TYPES = [
  'out',
  'aux',
  'aes',
  'aes50a',
  'aes50b',
  'card',
  'p16',
] as const;

// OSC-path regular expressions. Anchored like the Python originals.
export const CONFIG_RE =
  /^\/(ch|auxin|bus|mtx|main|fxrtn)\/([0-3][0-9]|st|m)\/config$/;

export const ROUTING_RE = /^\/config\/routing\/(IN|PLAY|AES50A|AES50B|CARD|OUT)/;

export const USERROUTING_RE = /^\/config\/userrout\/(in|out)/;

export const ROUTESWITCH_RE = /^\/config\/routing\/routswitch$/;

export const OUTPUTS_RE = /^\/outputs\/(aux|aes|main|p16)\/([0-3][0-9])$/;

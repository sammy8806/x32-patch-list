/**
 * Display helpers — ports of the name-formatting functions in `legacy/main.py`.
 *
 * These sit between the parser and the UI: the parser exposes internal keys
 * (`in.04`, `main.l`) and these turn them into the strings shown in the
 * patch-list tables.
 */

import { CHANNEL_NAMES, MIX_NAMES, TYPE_NAMES } from './constants.js';
import type { Channel } from './types.js';

/** Prefix a channel index with its mix name. */
export function getMixName(type: string, n: string): string {
  const name = MIX_NAMES[type] ?? type;
  if (type === 'main') return `${name} ${n.toUpperCase()}`;
  // Digits get zero-padded to 2; other tokens (like 'l','r','m') pass through.
  const suffix = /^\d+$/.test(n) ? String(parseInt(n, 10)).padStart(2, '0') : n;
  return `${name} ${suffix}`;
}

/** Prefix a channel index with its channel type (e.g. `Aux 01`). */
export function getChannelName(type: string, n: number | string): string {
  if (type in CHANNEL_NAMES) return `${CHANNEL_NAMES[type]} ${n}`;
  return String(n);
}

/** Human-readable desk name for a channel (mix-family or input-family). */
export function getDeskName(chan: Channel | null | undefined): string {
  if (!chan) return '';
  if (chan.mix && chan.mix_index !== undefined) {
    return getMixName(chan.mix, chan.mix_index);
  }
  if (chan.channel && chan.channel_index !== undefined) {
    return getChannelName(chan.channel, chan.channel_index);
  }
  return '';
}

/** Label for a local-input slot, handling the Aux In / USB L/R mapping. */
export function getTypeName(type: string, n: number): string {
  if (type === 'in' && n > 32) return 'Aux In';
  return TYPE_NAMES[type] ?? type;
}

/** Render the "source index" column for an input row (1-32, Aux 1-6, USB). */
export function getSourceIndex(type: string, n: number): string | number {
  if (type !== 'in') return n;
  if (n < 33) return n;
  if (n < 39) return `Aux ${n - 32}`;
  if (n < 40) return 'USB L';
  if (n < 41) return 'USB R';
  return n;
}

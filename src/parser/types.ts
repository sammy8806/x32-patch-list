/**
 * Type definitions for the parsed X32 scene model.
 *
 * All channel/route keys follow the form `<type>.<index>` where index is
 * zero-padded to 2 digits (e.g. `in.01`, `aes50a.48`, `user-out.12`). Output
 * mains use `main.l` / `main.r` / `main.m` since they are not numeric.
 */

/** A configured mixer channel (input strip, bus, matrix, main, or fx return). */
export interface Channel {
  name?: string;
  color?: string;

  /** Physical source label to show on output patch rows, when distinct. */
  output_source_label?: string;

  /** For input strips: the logical route slot this channel reads from. */
  route_key?: string;

  /** For input strips: the input-family type (`in` for ch, `auxin`). */
  channel?: string;

  /** For input strips: 1-based channel index. */
  channel_index?: number;

  /** For mix-style channels: the mix family (`bus`, `main`, `mtx`, `fxrtn`). */
  mix?: string;

  /** For mix-style channels: index token (e.g. '01', 'l', 'r', 'm'). */
  mix_index?: string;

  /** Marks internal virtual channels (talkback, monitor). */
  internal?: 'tb' | 'mon';
}

/** A routing table entry for a physical input/output slot. */
export interface RouteEntry {
  off?: true;
  name?: string;
  output_key?: string | null;
  source_key?: string | null;
  user_route?: boolean;
  user_route_key?: string | null;
}

/** An output slot resolved to a P-16 passthrough. */
export interface P16OutputRow {
  p16: true;
}

/** The parsed scene model. Produced by {@link ScnParser.parseText}. */
export interface ParsedScene {
  /** The active input routing switch (REC vs PLAY). */
  routingSwitch: 'IN' | 'PLAY';
  /** Merged routing table for the currently-active switch. */
  route: Record<string, RouteEntry>;
  /** Known configured channels, keyed by channel key. */
  channels: Record<string, Channel>;
  /** Output assignments (source channel per output slot). */
  outputs: Record<string, string | null>;
  /** Channels that read from a given route key. */
  channelByRoute: Record<string, Channel[]>;
  /** Reverse index: what routes feed a given source. */
  inputRouteSource: Record<string, string[]>;
  /** Reverse index: output slot → source route. */
  outputRouteSource: Record<string, string>;
  /** User routing map: slot key (e.g. `user-in.01`) → underlying source. */
  userRouteByName: Record<string, string | null>;
  /** Reverse index: underlying source → list of user slot keys. */
  userRouteBySource: Record<string, string[]>;
  /** Both IN and PLAY routing maps (unmerged). */
  inputRoute: { IN: Record<string, RouteEntry>; PLAY: Record<string, RouteEntry> };
}

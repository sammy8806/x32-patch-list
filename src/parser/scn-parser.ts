/**
 * X32 scene (.scn) parser.
 *
 * A direct port of `legacy/x32parser.py` — the parser walks each line of a
 * scene file, dispatches to a handler based on the OSC path prefix, and builds
 * up the routing / channel / output tables that the UI renders from.
 *
 * Semantics match the Python original. The Python unit tests are ported
 * verbatim into `tests/scn-parser.test.ts`.
 */

import {
  CONFIG_RE,
  INPUT_CONFIG_TYPES,
  MAX_CHANNELS,
  MAX_OUTPUTS,
  OUTPUTS_RE,
  OUTPUT_CONFIG_TYPES,
  ROUTESWITCH_RE,
  ROUTING_RE,
  USERROUTING_RE,
} from './constants.js';
import {
  getChannelKeyFromSource,
  getRouteKeyFromSource,
  getUserRouteKey,
  getUserRouteSource,
} from './sources.js';
import {
  nameFromRouteGroup,
  routeSourceFromRouteGroup,
} from './routing.js';
import { tokenizeLine } from './tokenize.js';
import type { Channel, ParsedScene, P16OutputRow, RouteEntry } from './types.js';

const pad2 = (n: number | string): string => String(n).padStart(2, '0');

type RoutingType = 'IN' | 'PLAY' | 'AES50A' | 'AES50B' | 'CARD' | 'OUT';

export class ScnParser {
  route: Record<string, RouteEntry> = {};
  channels: Record<string, Channel> = {};
  outputs: Record<string, string | null> = {};
  channelByRoute: Record<string, Channel[]> = {};
  inputRouteSource: Record<string, string[]> = {};
  outputRouteSource: Record<string, string> = {};
  userRouteByName: Record<string, string | null> = {};
  userRouteBySource: Record<string, string[]> = {};
  inputRoute: { IN: Record<string, RouteEntry>; PLAY: Record<string, RouteEntry> } = {
    IN: {},
    PLAY: {},
  };
  routingSwitch: 'IN' | 'PLAY' = 'IN';

  /** Parse an entire scene file from its text content. */
  parseText(text: string): void {
    this.reset();

    for (const rawLine of text.split(/\r?\n/)) {
      if (!rawLine) continue;
      const tokens = tokenizeLine(rawLine);
      if (tokens.length === 0) continue;
      const head = tokens[0];

      if (ROUTESWITCH_RE.test(head)) {
        this.parseRouteSwitch(tokens);
      } else if (ROUTING_RE.test(head)) {
        this.parseRouting(tokens);
      } else if (CONFIG_RE.test(head)) {
        this.parseConfig(tokens);
      } else if (OUTPUTS_RE.test(head)) {
        this.parseOutput(tokens);
      } else if (USERROUTING_RE.test(head)) {
        this.parseUser(tokens);
      }
    }

    this.applyActiveInputRouting();

    // Synthesized channels for the internal virtual sources.
    this.channels.tb = { name: 'Talkback', color: 'INT', internal: 'tb' };
    this.channels['mon.l'] = { name: 'Monitor L', color: 'INT', internal: 'mon' };
    this.channels['mon.r'] = { name: 'Monitor R', color: 'INT', internal: 'mon' };
  }

  /** Reset all state so the parser can be reused for a second file. */
  private reset(): void {
    this.route = {};
    this.channels = {};
    this.outputs = {};
    this.channelByRoute = {};
    this.inputRouteSource = {};
    this.outputRouteSource = {};
    this.userRouteByName = {};
    this.userRouteBySource = {};
    this.inputRoute = { IN: {}, PLAY: {} };
    this.routingSwitch = 'IN';
  }

  private parseRouteSwitch(tokens: string[]): void {
    this.routingSwitch = tokens.length > 1 && tokens[1] === '1' ? 'PLAY' : 'IN';
  }

  private parseUser(tokens: string[]): void {
    const match = tokens[0].match(USERROUTING_RE);
    if (!match) return;
    const routingType = match[1] as 'in' | 'out';

    tokens.slice(1).forEach((chanStr, idx) => {
      const chan = parseInt(chanStr, 10);
      const item = getUserRouteSource(routingType, chan);
      const name = `user-${routingType}.${pad2(idx + 1)}`;
      this.userRouteByName[name] = item;
      if (item) {
        (this.userRouteBySource[item] ??= []).push(name);
      }
    });
  }

  private buildRouteEntry(
    routeSource: string | null,
    group: string,
    offset: number,
    routingType: RoutingType,
  ): RouteEntry {
    const name = nameFromRouteGroup(group, offset);
    if (!name) return { off: true };

    return {
      name,
      output_key: routingType !== 'IN' ? routeSource : null,
      source_key: routeSource,
      user_route: group.startsWith('UOUT') || group.startsWith('UIN'),
      user_route_key: routeSource ? getUserRouteKey(group, offset) : null,
    };
  }

  private parseRouting(tokens: string[]): void {
    const match = tokens[0].match(ROUTING_RE);
    if (!match) return;
    const routingType = match[1] as RoutingType;

    // Note: `AUX in block` is a special case in the X32 format — only a few
    // values are valid there and the remaining slots stay as defaults. The
    // Python parser has a TODO to handle it; we preserve that behaviour.
    const groupSize = routingType === 'OUT' ? 4 : 8;
    const isInputRoute = routingType === 'IN' || routingType === 'PLAY';
    const target = isInputRoute ? this.inputRoute[routingType] : this.route;

    tokens.slice(1).forEach((group, n) => {
      for (let i = 0; i < groupSize; i++) {
        const slot = n * groupSize + i + 1;
        const routePath = isInputRoute
          ? `in.${pad2(slot)}`
          : `${routingType.toLowerCase()}.${pad2(slot)}`;

        const routeSource = routeSourceFromRouteGroup(group, i, this.userRouteByName);
        const effectiveRoutingType = isInputRoute ? 'IN' : routingType;
        const entry = this.buildRouteEntry(routeSource, group, i, effectiveRoutingType);
        target[routePath] = entry;

        if (!isInputRoute && routeSource) {
          this.outputRouteSource[routePath] = routeSource;
        }
      }
    });
  }

  /** Apply the active REC/PLAY input map and index it by source. */
  private applyActiveInputRouting(): void {
    this.inputRouteSource = {};

    for (const [routePath, entry] of Object.entries(this.inputRoute[this.routingSwitch])) {
      this.route[routePath] = entry;
      const routeSource = entry.source_key;
      if (routeSource) {
        (this.inputRouteSource[routeSource] ??= []).push(routePath);
      }
    }
  }

  private parseOutput(tokens: string[]): void {
    const match = tokens[0].match(OUTPUTS_RE);
    if (!match) return;

    let [, configType, chNum] = match;
    if (tokens.length !== 4) {
      throw new Error(`Splitting output line failed: ${tokens.join(' ')}`);
    }
    const [, sourceStr] = tokens;

    if (configType === 'main') configType = 'out';

    this.outputs[`${configType}.${chNum}`] = getChannelKeyFromSource(
      parseInt(sourceStr, 10),
    );
  }

  private parseConfig(tokens: string[]): void {
    const match = tokens[0].match(CONFIG_RE);
    if (!match) return;
    let [, configType, chNum] = match;

    if ((OUTPUT_CONFIG_TYPES as readonly string[]).includes(configType)) {
      if (tokens.length !== 4) {
        throw new Error(`Splitting output line failed: ${tokens.join(' ')}`);
      }
      const [, name, , colour] = tokens;

      if (configType === 'main' && chNum === 'st') chNum = 'l';

      this.channels[`${configType}.${chNum}`] = {
        name,
        color: colour,
        mix_index: chNum,
        mix: configType,
      };

      if (configType === 'main' && chNum === 'l') {
        this.channels['main.r'] = { ...this.channels['main.l'], mix_index: 'r' };
      }
    } else if ((INPUT_CONFIG_TYPES as readonly string[]).includes(configType)) {
      if (tokens.length !== 5) {
        throw new Error(`Splitting input line failed: ${tokens.join(' ')}`);
      }
      const [, name, , colour, source] = tokens;

      if (configType === 'ch') configType = 'in';

      const routeKey = getRouteKeyFromSource(parseInt(source, 10));
      const chanKey = `${configType}.${chNum}`;
      const channel: Channel = {
        name,
        route_key: routeKey ?? undefined,
        channel: configType,
        channel_index: parseInt(chNum, 10),
        color: colour,
      };
      this.channels[chanKey] = channel;
      if (routeKey) {
        (this.channelByRoute[routeKey] ??= []).push(channel);
      }
    } else if (configType === 'fxrtn') {
      if (tokens.length !== 4) {
        throw new Error(`Splitting fx line failed: ${tokens.join(' ')}`);
      }
      const [, name, , colour] = tokens;
      this.channels[`fx.${chNum}`] = {
        name,
        color: colour,
        mix_index: chNum,
        mix: 'fxrtn',
      };
    }
  }

  // ---------------- Query API ----------------

  private getChannelsForInputSource(source: string): Channel[] {
    const routedKeys = this.inputRouteSource[source];
    if (!routedKeys) return [];

    const routedChannels: Channel[] = [];
    for (const routeKey of routedKeys) {
      const channels = this.channelByRoute[routeKey];
      if (channels) routedChannels.push(...channels);
    }
    return routedChannels;
  }

  private getOutputSourceFallback(source: string): Channel | null {
    const match = source.match(/^([a-z0-9]+)\.([0-9]{2})$/);
    if (!match) return null;

    const [, type, indexStr] = match;
    const index = parseInt(indexStr, 10);

    switch (type) {
      case 'in':
        if (index <= 32) return { name: `Local ${pad2(index)}`, color: 'OFF' };
        if (index <= 38) return { name: `Aux In ${pad2(index - 32)}`, color: 'OFF' };
        if (index === 39) return { name: 'USB L', color: 'OFF' };
        if (index === 40) return { name: 'USB R', color: 'OFF' };
        return null;
      case 'aes50a':
        return { name: `AES50-A ${indexStr}`, color: 'OFF' };
      case 'aes50b':
        return { name: `AES50-B ${indexStr}`, color: 'OFF' };
      case 'card':
        return { name: `Card ${indexStr}`, color: 'OFF' };
      case 'auxin':
        return { name: `Aux ${index}`, color: 'OFF' };
      default:
        return null;
    }
  }

  private resolveOutputSource(source: string | null | undefined): Channel | null {
    if (!source) return null;

    // If the source points back at another output, chain through.
    const linkedSource = source in this.outputs ? this.outputs[source] : source;
    if (!linkedSource) return null;

    const routedInputChannel = this.getChannelsForInputSource(linkedSource)[0];
    if (routedInputChannel) return routedInputChannel;

    return this.channels[linkedSource] ?? this.getOutputSourceFallback(linkedSource);
  }

  /** Return the route entry for a route key, or `undefined`. */
  getRoute(routeKey: string): RouteEntry | undefined {
    return this.route[routeKey];
  }

  /** Returns the channel for the given key, or `undefined`. */
  getChannel(key: string): Channel | undefined {
    const c = this.channels[key];
    return c ? { ...c } : undefined;
  }

  /** True when at least one non-empty row exists in the given patch list. */
  hasTypeAnythingAssigned(rows: readonly unknown[]): boolean {
    return rows.some((row) => row !== null && row !== undefined);
  }

  /**
   * Resolve a physical output-type patch into a list of rows.
   * P-16 outputs that act as passthroughs produce `{ p16: true }`.
   */
  getOutputListForType(outputType: string): Array<Channel | P16OutputRow | null> {
    const max = MAX_OUTPUTS[outputType];
    if (max === undefined) return [];

    const patch: Array<Channel | P16OutputRow | null> = [];
    for (let i = 0; i < max; i++) {
      const key = `${outputType}.${pad2(i + 1)}`;
      let source: string | null | undefined;

      if (outputType === 'p16' || outputType === 'aux' || outputType === 'aes') {
        source = this.outputs[key];
        if (!source) {
          patch.push(null);
          continue;
        }
      } else if (key in this.outputRouteSource) {
        source = this.outputRouteSource[key];
      } else {
        patch.push(null);
        continue;
      }

      if (source && source.startsWith('p16')) {
        patch.push({ p16: true });
        continue;
      }

      patch.push(this.resolveOutputSource(source));
    }
    return patch;
  }

  /**
   * Resolve a physical input-type into a list of rows. Each row is either
   * `null` (unrouted) or the list of channels reading from that slot.
   */
  getChannelListForType(inputType: string): Array<Channel[] | null> {
    const max = MAX_CHANNELS[inputType];
    if (max === undefined) return [];

    const patch: Array<Channel[] | null> = [];
    for (let i = 0; i < max; i++) {
      const key = `${inputType}.${pad2(i + 1)}`;
      const routedKeys = this.inputRouteSource[key];
      if (!routedKeys) {
        patch.push(null);
        continue;
      }

      const routedChannels = this.getChannelsForInputSource(key);
      patch.push(routedChannels.length > 0 ? routedChannels : null);
    }
    return patch;
  }

  /** True when the given slot key is fed via user routing. */
  isUserRouted(chan: string): boolean {
    const entry = this.route[chan];
    return entry?.user_route === true;
  }

  /**
   * User-input slot (e.g. `user-in.04`) that points at the given source key.
   *
   * Input patch tables render source rows (`aes50a.01`, `card.25`, etc.), not
   * route-slot rows, so they must resolve through `userRouteBySource` rather
   * than `this.route`.
   */
  getInputUserRoutePosition(sourceKey: string): string | null {
    const matches = this.userRouteBySource[sourceKey];
    if (!matches) return null;
    return matches.find((key) => key.startsWith('user-in.')) ?? null;
  }

  /** User-route key (e.g. `user-out.04`) for an output route slot, or `null`. */
  getOutputUserRoutePosition(chan: string): string | null {
    return this.route[chan]?.user_route_key ?? null;
  }
}

/** Convenience wrapper: parse scene text into the plain-data model. */
export function parseSceneText(text: string): ParsedScene & { _parser: ScnParser } {
  const parser = new ScnParser();
  parser.parseText(text);
  return {
    routingSwitch: parser.routingSwitch,
    route: parser.route,
    channels: parser.channels,
    outputs: parser.outputs,
    channelByRoute: parser.channelByRoute,
    inputRouteSource: parser.inputRouteSource,
    outputRouteSource: parser.outputRouteSource,
    userRouteByName: parser.userRouteByName,
    userRouteBySource: parser.userRouteBySource,
    inputRoute: parser.inputRoute,
    _parser: parser,
  };
}

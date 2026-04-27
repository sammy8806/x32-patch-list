import {
  OUTPUT_TABLE_TYPES,
  TYPE_NAMES,
} from './parser/constants.js';
import { getDeskName, getSourceIndex } from './parser/display.js';
import type { ScnParser } from './parser/scn-parser.js';
import type { Channel, P16OutputRow } from './parser/types.js';

const PAD = (value: number | string): string => String(value).padStart(2, '0');

const CHANNEL_COLOR: Record<string, string> = {
  RD: '#ef4444',
  RDi: '#ef4444',
  YE: '#d97706',
  YEi: '#d97706',
  GN: '#16a34a',
  GNi: '#16a34a',
  CY: '#0891b2',
  CYi: '#0891b2',
  BL: '#2563eb',
  BLi: '#2563eb',
  MG: '#c026d3',
  MGi: '#c026d3',
  WH: '#6b7280',
  WHi: '#6b7280',
  OFF: '#a1a1aa',
  OFFi: '#a1a1aa',
  INT: '#64748b',
};

const TYPE_ORDER = new Map(
  [
    'in',
    'auxin',
    'aes50a',
    'aes50b',
    'card',
    'out',
    'aux',
    'aes',
    'p16',
    'bus',
    'main',
    'mtx',
    'fx',
    'tb',
    'mon',
  ].map((type, index) => [type, index]),
);

export interface RoutingEndpoint {
  id: string;
  key: string;
  label: string;
  name: string;
  meta: string;
  group: string;
  color: string;
  active: boolean;
}

export interface RoutingConnection {
  fromPin: string;
  toPin: string;
  color: string;
  kind: 'normal' | 'bypass';
}

export interface UserRouteSlot {
  id: string;
  key: string;
  label: string;
  meta: string;
  sourceKey: string | null;
  color: string;
  active: boolean;
}

export interface RoutingVisualModel {
  sources: RoutingEndpoint[];
  processors: RoutingEndpoint[];
  outputs: RoutingEndpoint[];
  userInputs: UserRouteSlot[];
  userOutputs: UserRouteSlot[];
  connections: RoutingConnection[];
  stats: {
    sources: number;
    processors: number;
    outputs: number;
    activeUserInputs: number;
    activeUserOutputs: number;
  };
}

type Producer =
  | { kind: 'source'; key: string; color: string }
  | { kind: 'processor'; key: string; color: string };

export function buildRoutingVisualModel(parser: ScnParser): RoutingVisualModel {
  const sourceKeys = new Map<string, string>();
  const processorKeys = new Map<string, string>();
  const outputKeys = new Map<string, { color: string; row: Channel | null }>();
  const userInputColors = new Map<string, string>();
  const userOutputColors = new Map<string, string>();
  const connections: RoutingConnection[] = [];

  for (const [channelKey, channel] of Object.entries(parser.channels)) {
    if (!channel.route_key) continue;
    const route = parser.route[channel.route_key];
    if (!route?.source_key || route.source_key === 'off') continue;

    const color = colorForChannel(channel);
    sourceKeys.set(route.source_key, color);
    processorKeys.set(channelKey, color);

    if (route.user_route_key?.startsWith('user-in.')) {
      userInputColors.set(route.user_route_key, color);
      connections.push({
        fromPin: sourceOutPin(route.source_key),
        toPin: userInPin(route.user_route_key),
        color,
        kind: 'normal',
      });
      connections.push({
        fromPin: userOutPin(route.user_route_key),
        toPin: processorInPin(channelKey),
        color,
        kind: 'normal',
      });
    } else {
      connections.push({
        fromPin: sourceOutPin(route.source_key),
        toPin: processorInPin(channelKey),
        color,
        kind: 'bypass',
      });
    }
  }

  for (const outputType of OUTPUT_TABLE_TYPES) {
    const rows = parser.getOutputListForType(outputType);
    for (let index = 0; index < rows.length; index += 1) {
      const outputKey = `${outputType}.${PAD(index + 1)}`;
      const rawSource = rawOutputSource(parser, outputType, outputKey);
      if (!rawSource) continue;

      const row = outputRowChannel(rows[index]);
      const producer = resolveProducer(parser, rawSource, sourceKeys, processorKeys);
      if (!producer) continue;

      const color = row ? colorForChannel(row) : producer.color;
      outputKeys.set(outputKey, { color, row });

      const userRouteKey = parser.getOutputUserRoutePosition(outputKey);
      if (userRouteKey?.startsWith('user-out.')) {
        userOutputColors.set(userRouteKey, color);
        connections.push({
          fromPin: producerPin(producer),
          toPin: userInPin(userRouteKey),
          color,
          kind: 'normal',
        });
        connections.push({
          fromPin: userOutPin(userRouteKey),
          toPin: outputInPin(outputKey),
          color,
          kind: 'normal',
        });
      } else {
        connections.push({
          fromPin: producerPin(producer),
          toPin: outputInPin(outputKey),
          color,
          kind: 'bypass',
        });
      }
    }
  }

  const sources = [...sourceKeys.entries()]
    .map(([key, color]) => sourceEndpoint(key, color))
    .sort(endpointSort);
  const processors = [...processorKeys.entries()]
    .map(([key, color]) => processorEndpoint(parser, key, color))
    .sort(endpointSort);
  const outputs = [...outputKeys.entries()]
    .map(([key, detail]) => outputEndpoint(key, detail.color, detail.row))
    .sort(endpointSort);
  const userInputs = buildUserSlots(
    parser.userRouteByName,
    'user-in',
    32,
    userInputColors,
  );
  const userOutputs = buildUserSlots(
    parser.userRouteByName,
    'user-out',
    48,
    userOutputColors,
  );

  return {
    sources,
    processors,
    outputs,
    userInputs,
    userOutputs,
    connections,
    stats: {
      sources: sources.length,
      processors: processors.length,
      outputs: outputs.length,
      activeUserInputs: userInputs.filter((slot) => slot.active).length,
      activeUserOutputs: userOutputs.filter((slot) => slot.active).length,
    },
  };
}

export function sourceOutPin(key: string): string {
  return `src:${key}:out`;
}

export function processorInPin(key: string): string {
  return `proc:${key}:in`;
}

export function processorOutPin(key: string): string {
  return `proc:${key}:out`;
}

export function outputInPin(key: string): string {
  return `out:${key}:in`;
}

export function userInPin(key: string): string {
  return `user:${key}:in`;
}

export function userOutPin(key: string): string {
  return `user:${key}:out`;
}

function rawOutputSource(
  parser: ScnParser,
  outputType: string,
  outputKey: string,
): string | null {
  if (outputType === 'p16' || outputType === 'aux' || outputType === 'aes') {
    return parser.outputs[outputKey] ?? null;
  }
  return parser.outputRouteSource[outputKey] ?? null;
}

function outputRowChannel(
  row: Channel | P16OutputRow | null,
): Channel | null {
  return row && !('p16' in row) ? row : null;
}

function resolveProducer(
  parser: ScnParser,
  rawSource: string,
  sourceKeys: Map<string, string>,
  processorKeys: Map<string, string>,
): Producer | null {
  const linkedSource = rawSource in parser.outputs ? parser.outputs[rawSource] : rawSource;
  if (!linkedSource) return null;

  const directChannel = parser.channels[linkedSource];
  if (directChannel) {
    const color = colorForChannel(directChannel);
    processorKeys.set(linkedSource, color);
    return { kind: 'processor', key: linkedSource, color };
  }

  const routedChannel = firstChannelForSource(parser, linkedSource);
  if (routedChannel) {
    const color = colorForChannel(routedChannel.channel);
    processorKeys.set(routedChannel.key, color);
    return { kind: 'processor', key: routedChannel.key, color };
  }

  sourceKeys.set(linkedSource, sourceKeys.get(linkedSource) ?? '#6b7280');
  return { kind: 'source', key: linkedSource, color: '#6b7280' };
}

function firstChannelForSource(
  parser: ScnParser,
  sourceKey: string,
): { key: string; channel: Channel } | null {
  const routeKeys = parser.inputRouteSource[sourceKey];
  if (!routeKeys) return null;

  for (const routeKey of routeKeys) {
    const channels = parser.channelByRoute[routeKey];
    const first = channels?.[0];
    if (!first) continue;
    const match = Object.entries(parser.channels).find(([, channel]) => channel === first);
    if (match) return { key: match[0], channel: first };
  }
  return null;
}

function producerPin(producer: Producer): string {
  return producer.kind === 'source'
    ? sourceOutPin(producer.key)
    : processorOutPin(producer.key);
}

function colorForChannel(channel: Channel): string {
  return CHANNEL_COLOR[channel.color ?? 'OFF'] ?? '#64748b';
}

function sourceEndpoint(key: string, color: string): RoutingEndpoint {
  const { label, name, group } = sourceParts(key);
  return {
    id: `src:${key}`,
    key,
    label,
    name,
    meta: key,
    group,
    color,
    active: true,
  };
}

function processorEndpoint(
  parser: ScnParser,
  key: string,
  color: string,
): RoutingEndpoint {
  const channel = parser.channels[key];
  const deskName = getDeskName(channel);
  const name = channel?.name ?? '';
  return {
    id: `proc:${key}`,
    key,
    label: deskName || sourceParts(key).label,
    name,
    meta: key,
    group: processorGroup(key),
    color,
    active: true,
  };
}

function outputEndpoint(
  key: string,
  color: string,
  row: Channel | null,
): RoutingEndpoint {
  const [type, index] = key.split('.');
  const label = `${TYPE_NAMES[type] ?? type} ${Number(index) || index}`;
  return {
    id: `out:${key}`,
    key,
    label,
    name: row?.name ?? row?.output_source_label ?? '',
    meta: row?.output_source_label ?? key,
    group: outputGroup(type),
    color,
    active: true,
  };
}

function buildUserSlots(
  userRouteByName: Record<string, string | null>,
  prefix: 'user-in' | 'user-out',
  total: number,
  colors: Map<string, string>,
): UserRouteSlot[] {
  let maxActiveIndex = 0;
  for (const [key, sourceKey] of Object.entries(userRouteByName)) {
    if (!key.startsWith(`${prefix}.`) || !sourceKey) continue;
    maxActiveIndex = Math.max(maxActiveIndex, Number(key.split('.')[1]) || 0);
  }

  const visibleTotal = Math.min(total, Math.max(12, maxActiveIndex));
  const slots: UserRouteSlot[] = [];
  for (let index = 1; index <= visibleTotal; index += 1) {
    const key = `${prefix}.${PAD(index)}`;
    const sourceKey = userRouteByName[key] ?? null;
    const source = sourceKey ? sourceParts(sourceKey) : null;
    slots.push({
      id: `user:${key}`,
      key,
      label: `U-${PAD(index)}`,
      meta: source?.label ?? '',
      sourceKey,
      color: colors.get(key) ?? '#94a3b8',
      active: sourceKey !== null,
    });
  }
  return slots;
}

function sourceParts(key: string): { label: string; name: string; group: string } {
  const [type, indexRaw = ''] = key.split('.');
  const index = Number(indexRaw);

  if (type === 'in') {
    return {
      label: String(getSourceIndex('in', index)),
      name: index <= 32 ? `Local ${PAD(index)}` : String(getSourceIndex('in', index)),
      group: index <= 32 ? 'Local Inputs' : 'Aux / USB',
    };
  }
  if (type === 'aes50a') return sourceResult(`A ${PAD(index)}`, 'AES50-A', 'AES50-A');
  if (type === 'aes50b') return sourceResult(`B ${PAD(index)}`, 'AES50-B', 'AES50-B');
  if (type === 'card') return sourceResult(`Card ${PAD(index)}`, 'Card', 'Card');
  if (type === 'auxin') return sourceResult(`Aux In ${index}`, 'Aux In', 'Aux / USB');
  if (type === 'out') return sourceResult(`Out ${PAD(index)}`, 'Output Tap', 'Output Taps');
  if (type === 'aux') return sourceResult(`Aux Out ${index}`, 'Aux Output', 'Output Taps');
  if (type === 'p16') return sourceResult(`P16 ${PAD(index)}`, 'Ultranet', 'Output Taps');
  if (type === 'main') return sourceResult(`Main ${indexRaw.toUpperCase()}`, 'Main', 'Mix Outputs');
  if (type === 'mon') return sourceResult(`Monitor ${indexRaw.toUpperCase()}`, 'Monitor', 'Internal');
  if (key === 'tb') return sourceResult('Talkback', 'Talkback', 'Internal');
  return sourceResult(key, key, 'Other Sources');
}

function sourceResult(
  label: string,
  name: string,
  group: string,
): { label: string; name: string; group: string } {
  return { label, name, group };
}

function processorGroup(key: string): string {
  const [type] = key.split('.');
  if (type === 'in') return 'Input Channels';
  if (type === 'auxin') return 'Aux Input Channels';
  if (type === 'bus') return 'Buses';
  if (type === 'main') return 'Main';
  if (type === 'mtx') return 'Matrices';
  if (type === 'fx') return 'FX Returns';
  return 'Processors';
}

function outputGroup(type: string): string {
  if (type === 'out') return 'Local Outputs';
  if (type === 'p16') return 'Ultranet';
  if (type === 'aux') return 'Aux Outputs';
  if (type === 'aes') return 'AES/EBU';
  if (type === 'aes50a') return 'AES50-A Outputs';
  if (type === 'aes50b') return 'AES50-B Outputs';
  if (type === 'card') return 'Card Outputs';
  return 'Outputs';
}

function endpointSort(a: RoutingEndpoint, b: RoutingEndpoint): number {
  return keySort(a.key, b.key);
}

function keySort(a: string, b: string): number {
  const [typeA, indexA = '0'] = a.split('.');
  const [typeB, indexB = '0'] = b.split('.');
  const orderA = TYPE_ORDER.get(typeA) ?? 999;
  const orderB = TYPE_ORDER.get(typeB) ?? 999;
  if (orderA !== orderB) return orderA - orderB;
  const numericA = Number(indexA);
  const numericB = Number(indexB);
  if (!Number.isNaN(numericA) && !Number.isNaN(numericB)) {
    return numericA - numericB;
  }
  return a.localeCompare(b);
}

import {
  INPUT_TABLE_TYPES,
  OUTPUT_TABLE_TYPES,
  TYPE_NAMES,
} from './parser/constants.js';
import { getDeskName, getSourceIndex } from './parser/display.js';
import type { ScnParser } from './parser/scn-parser.js';
import type { Channel, P16OutputRow } from './parser/types.js';

const PAD = (value: number | string): string => String(value).padStart(2, '0');
const OUTPUT_TAP_RE = /^out\.([0-9]{2})$/;

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
    'out-tap',
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

export interface RoutingVisibilityState {
  visibleRows?: Record<string, boolean>;
  visibleSections?: Record<string, boolean>;
  includeHidden?: boolean;
}

interface VisibilityContext {
  includeHidden: boolean;
  visibleSources: Set<string>;
  visibleProcessors: Set<string>;
  visibleOutputs: Set<string>;
}

type Producer =
  | { kind: 'source'; key: string; color: string }
  | { kind: 'processor'; key: string; color: string };

export function buildRoutingVisualModel(
  parser: ScnParser,
  visibility: RoutingVisibilityState = {},
): RoutingVisualModel {
  const visibilityContext = buildVisibilityContext(parser, visibility);
  const sourceKeys = new Map<string, string>();
  const processorKeys = new Map<string, string>();
  const outputKeys = new Map<string, { color: string; row: Channel | null }>();
  const userInputColors = new Map<string, string>();
  const userOutputColors = new Map<string, string>();
  const connections: RoutingConnection[] = [];
  const outputTaps = collectOutputTaps(parser, visibilityContext);

  for (const [channelKey, channel] of Object.entries(parser.channels)) {
    if (!channel.route_key) continue;
    if (!isProcessorVisible(visibilityContext, channelKey)) continue;
    const route = parser.route[channel.route_key];
    if (!route?.source_key || route.source_key === 'off') continue;
    if (!isSourceVisible(visibilityContext, route.source_key)) continue;

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

  for (const tapSourceKey of outputTaps) {
    if (!isProcessorVisible(visibilityContext, outputTapKey(tapSourceKey))) {
      continue;
    }
    const tapSource = parser.outputs[tapSourceKey];
    if (!tapSource) continue;

    const producer = resolveProducer(
      parser,
      tapSource,
      sourceKeys,
      processorKeys,
      visibilityContext,
    );
    if (!producer) continue;

    const color = outputTapColor(parser, tapSourceKey, producer.color);
    processorKeys.set(outputTapKey(tapSourceKey), color);
    connections.push({
      fromPin: producerPin(producer),
      toPin: processorInPin(outputTapKey(tapSourceKey)),
      color,
      kind: 'normal',
    });
  }

  for (const outputType of OUTPUT_TABLE_TYPES) {
    const rows = parser.getOutputListForType(outputType);
    for (let index = 0; index < rows.length; index += 1) {
      const outputKey = `${outputType}.${PAD(index + 1)}`;
      if (!isOutputVisible(visibilityContext, outputKey)) continue;
      const rawSource = rawOutputSource(parser, outputType, outputKey);
      if (!rawSource) continue;

      const row = outputRowChannel(rows[index]);
      const producer = resolveProducer(
        parser,
        rawSource,
        sourceKeys,
        processorKeys,
        visibilityContext,
      );
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
    visibilityContext.includeHidden,
  );
  const userOutputs = buildUserSlots(
    parser.userRouteByName,
    'user-out',
    48,
    userOutputColors,
    visibilityContext.includeHidden,
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

function collectOutputTaps(
  parser: ScnParser,
  visibility: VisibilityContext,
): Set<string> {
  const taps = new Set<string>();
  if (visibility.includeHidden) {
    for (const key of Object.keys(parser.outputs)) {
      if (isOutputTap(key)) taps.add(key);
    }
    return taps;
  }

  for (const outputKey of visibility.visibleOutputs) {
    const [outputType] = outputKey.split('.');
    const source = rawOutputSource(parser, outputType, outputKey);
    if (source && isOutputTap(source)) taps.add(source);
  }

  return taps;
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
  visibility: VisibilityContext,
): Producer | null {
  const linkedSource = rawSource in parser.outputs ? parser.outputs[rawSource] : rawSource;
  if (!linkedSource) return null;

  if (isOutputTap(rawSource)) {
    const key = outputTapKey(rawSource);
    if (!isProcessorVisible(visibility, key)) return null;
    const color = outputTapColor(parser, rawSource);
    processorKeys.set(key, color);
    return { kind: 'processor', key, color };
  }

  const directChannel = parser.channels[linkedSource];
  if (directChannel) {
    if (!isProcessorVisible(visibility, linkedSource)) return null;
    const color = colorForChannel(directChannel);
    processorKeys.set(linkedSource, color);
    return { kind: 'processor', key: linkedSource, color };
  }

  const routedChannel = firstChannelForSource(parser, linkedSource, visibility);
  if (routedChannel) {
    const color = colorForChannel(routedChannel.channel);
    processorKeys.set(routedChannel.key, color);
    return { kind: 'processor', key: routedChannel.key, color };
  }

  if (!isSourceVisible(visibility, linkedSource)) return null;
  sourceKeys.set(linkedSource, sourceKeys.get(linkedSource) ?? '#6b7280');
  return { kind: 'source', key: linkedSource, color: '#6b7280' };
}

function firstChannelForSource(
  parser: ScnParser,
  sourceKey: string,
  visibility: VisibilityContext,
): { key: string; channel: Channel } | null {
  const routeKeys = parser.inputRouteSource[sourceKey];
  if (!routeKeys) return null;

  for (const routeKey of routeKeys) {
    const channels = parser.channelByRoute[routeKey];
    if (!channels) continue;
    for (const channel of channels) {
      const match = Object.entries(parser.channels).find(([, candidate]) => candidate === channel);
      if (match && isProcessorVisible(visibility, match[0])) {
        return { key: match[0], channel };
      }
    }
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

function outputTapColor(
  parser: ScnParser,
  sourceKey: string,
  fallback = '#64748b',
): string {
  const source = parser.outputs[sourceKey];
  if (!source) return fallback;
  const channel = parser.channels[source];
  return channel ? colorForChannel(channel) : fallback;
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
  if (isOutputTapKey(key)) {
    const sourceKey = outputTapSourceKey(key);
    const source = sourceKey ? parser.outputs[sourceKey] : null;
    const sourceChannel = source ? parser.channels[source] : undefined;
    const [, index = ''] = key.split('.');
    return {
      id: `proc:${key}`,
      key,
      label: `Out ${index}`,
      name: sourceChannel?.name ?? sourceParts(source ?? '').label,
      meta: source ?? key,
      group: 'Out 1-16',
      color,
      active: true,
    };
  }

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
  includeHidden: boolean,
): UserRouteSlot[] {
  if (!includeHidden) {
    return [...colors.keys()]
      .filter((key) => key.startsWith(`${prefix}.`))
      .sort(keySort)
      .map((key) => {
        const sourceKey = userRouteByName[key] ?? null;
        const source = sourceKey ? sourceParts(sourceKey) : null;
        return {
          id: `user:${key}`,
          key,
          label: `U-${key.split('.')[1] ?? ''}`,
          meta: source?.label ?? '',
          sourceKey,
          color: colors.get(key) ?? '#94a3b8',
          active: sourceKey !== null,
        };
      });
  }

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
  if (type === 'out-tap') return 'Out 1-16';
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

function buildVisibilityContext(
  parser: ScnParser,
  visibility: RoutingVisibilityState,
): VisibilityContext {
  const context: VisibilityContext = {
    includeHidden: visibility.includeHidden === true,
    visibleSources: new Set(),
    visibleProcessors: new Set(),
    visibleOutputs: new Set(),
  };

  if (context.includeHidden) return context;

  const rowState = visibility.visibleRows ?? {};
  const sectionState = visibility.visibleSections ?? {};

  for (const inputType of INPUT_TABLE_TYPES) {
    const rows = parser.getChannelListForType(inputType);
    const sectionKey = `input:${inputType}`;
    const defaultSectionVisible = parser.hasTypeAnythingAssigned(rows);
    const sectionVisible =
      sectionKey in sectionState ? sectionState[sectionKey] : defaultSectionVisible;
    if (!sectionVisible) continue;

    rows.forEach((row, lineIndex) => {
      if (!row) return;
      const sourceKey = `${inputType}.${PAD(lineIndex + 1)}`;
      row.forEach((channel, subIndex) => {
        const rowKey = `input:${inputType}:${lineIndex}:${subIndex}`;
        const rowVisible = rowKey in rowState ? rowState[rowKey] : true;
        if (!rowVisible) return;

        const channelKey = channelKeyFor(parser, channel);
        if (!channelKey) return;
        context.visibleSources.add(sourceKey);
        context.visibleProcessors.add(channelKey);
      });
    });
  }

  for (const outputType of OUTPUT_TABLE_TYPES) {
    const rows = parser.getOutputListForType(outputType);
    const sectionKey = `output:${outputType}`;
    const defaultSectionVisible = parser.hasTypeAnythingAssigned(rows);
    const sectionVisible =
      sectionKey in sectionState ? sectionState[sectionKey] : defaultSectionVisible;
    if (!sectionVisible) continue;

    rows.forEach((row, lineIndex) => {
      if (!row) return;
      const rowKey = `output:${outputType}:${lineIndex}:0`;
      const rowVisible = rowKey in rowState ? rowState[rowKey] : true;
      if (rowVisible) {
        const outputKey = `${outputType}.${PAD(lineIndex + 1)}`;
        context.visibleOutputs.add(outputKey);
        addVisibleOutputProducer(parser, context, rawOutputSource(parser, outputType, outputKey));
      }
    });
  }

  return context;
}

function addVisibleOutputProducer(
  parser: ScnParser,
  context: VisibilityContext,
  rawSource: string | null,
): void {
  if (!rawSource) return;
  if (isOutputTap(rawSource)) {
    context.visibleProcessors.add(outputTapKey(rawSource));
    addVisibleOutputProducer(parser, context, parser.outputs[rawSource] ?? null);
    return;
  }

  const linkedSource = rawSource in parser.outputs ? parser.outputs[rawSource] : rawSource;
  if (!linkedSource) return;

  const channel = parser.channels[linkedSource];
  if (channel && !channel.route_key) {
    context.visibleProcessors.add(linkedSource);
    return;
  }

  if (!channel) {
    context.visibleSources.add(linkedSource);
  }
}

function channelKeyFor(parser: ScnParser, target: Channel): string | null {
  const match = Object.entries(parser.channels).find(([, channel]) => channel === target);
  return match?.[0] ?? null;
}

function isSourceVisible(context: VisibilityContext, key: string): boolean {
  return context.includeHidden || context.visibleSources.has(key);
}

function isProcessorVisible(context: VisibilityContext, key: string): boolean {
  return context.includeHidden || context.visibleProcessors.has(key);
}

function isOutputVisible(context: VisibilityContext, key: string): boolean {
  return context.includeHidden || context.visibleOutputs.has(key);
}

function isOutputTap(key: string): boolean {
  return OUTPUT_TAP_RE.test(key);
}

function outputTapKey(sourceKey: string): string {
  const match = sourceKey.match(OUTPUT_TAP_RE);
  return match ? `out-tap.${match[1]}` : sourceKey;
}

function isOutputTapKey(key: string): boolean {
  return key.startsWith('out-tap.');
}

function outputTapSourceKey(key: string): string | null {
  const [, index] = key.split('.');
  return index ? `out.${index}` : null;
}

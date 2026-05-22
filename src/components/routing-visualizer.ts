/**
 * <x32-routing-visualizer>
 *
 * Data-driven versions of design variants 05 and 06. The layout changes
 * between patchbay and node graph, but both render from the same routing model
 * and draw SVG wires between real DOM pins after layout.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';

import type { ScnParser } from '../parser/scn-parser.js';
import {
  buildRoutingVisualModel,
  outputInPin,
  processorInPin,
  processorOutPin,
  sourceOutPin,
  userInPin,
  userOutPin,
  type RoutingConnection,
  type RoutingEndpoint,
  type RoutingVisualModel,
  type UserRouteSlot,
} from '../routing-visual-model.js';

export type RoutingVisualMode = 'patchbay' | 'nodes';

type NodeGraphKind = 'source' | 'processor' | 'output' | 'user-patch';

const NODE_GRAPH_LABEL_TOP = 12;
const NODE_GRAPH_TOP = 44;
const NODE_GRAPH_GAP = 22;

interface NodePoint {
  x: number;
  y: number;
}

interface NodeGraphNode {
  id: string;
  kind: NodeGraphKind;
  title: string;
  badge: string;
  rank: number;
  naturalOrder: number;
  rowCount: number;
  endpoints?: RoutingEndpoint[];
  slots?: UserRouteSlot[];
}

interface PositionedNode extends NodeGraphNode {
  x: number;
  y: number;
  height: number;
}

interface NodeGraphLayout {
  nodes: PositionedNode[];
  lanes: Array<{ label: string; rank: number; x: number }>;
  width: number;
  height: number;
}

interface NodeDragState {
  id: string;
  startPointerX: number;
  startPointerY: number;
  startX: number;
  startY: number;
}

@customElement('x32-routing-visualizer')
export class RoutingVisualizer extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) parser!: ScnParser;
  @property({ type: String }) mode: RoutingVisualMode = 'patchbay';
  @property({ type: String }) filename = '';
  @property({ attribute: false }) visibleRows: Record<string, boolean> = {};
  @property({ attribute: false }) visibleSections: Record<string, boolean> = {};

  @state() private previewPins: string[] = [];
  @state() private lockedPins: string[] = [];
  @state() private previewConnection: string | null = null;
  @state() private lockedConnection: string | null = null;
  @state() private includeHidden = false;
  @state() private nodeOverrides: Record<string, NodePoint> = {};

  private model: RoutingVisualModel | null = null;

  private frame = 0;
  private dragState: NodeDragState | null = null;
  private onWindowResize = () => this.scheduleDraw();

  override willUpdate(): void {
    this.model = this.parser
      ? buildRoutingVisualModel(this.parser, {
          visibleRows: this.visibleRows,
          visibleSections: this.visibleSections,
          includeHidden: this.includeHidden,
        })
      : null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('resize', this.onWindowResize);
  }

  override disconnectedCallback(): void {
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('pointermove', this.onNodeDragMove);
    window.removeEventListener('pointerup', this.onNodeDragEnd);
    cancelAnimationFrame(this.frame);
    super.disconnectedCallback();
  }

  override updated(): void {
    this.scheduleDraw();
  }

  override render() {
    if (!this.model || this.model.connections.length === 0) {
      return html`
        <section class="routing-empty">
          <h2>Routing view</h2>
          <p>No active routing paths were found in this scene.</p>
          ${this.renderVisibilityToggle()}
        </section>
      `;
    }

    return this.mode === 'nodes'
      ? this.renderNodeGraph(this.model)
      : this.renderPatchbay(this.model);
  }

  private renderPatchbay(model: RoutingVisualModel) {
    return html`
      <section
        class=${classMap({
          'routing-visual': true,
          'routing-patchbay': true,
          'highlight-active': this.hasHighlight(),
        })}
      >
        ${this.renderPatchbayHeader(model)}
        <div class="rv-bay rv-wire-stage" @click=${this.clearLockedHighlight}>
          <span class="rv-screw tl"></span>
          <span class="rv-screw tr"></span>
          <span class="rv-screw bl"></span>
          <span class="rv-screw br"></span>
          <svg class="routing-wires" aria-hidden="true"></svg>

          <div class="rv-columns">
            <div class="rv-col rv-source-col">
              ${this.renderColumnHeader('Sources', model.stats.sources)}
              ${this.renderEndpointGroups(model.sources, 'source')}
            </div>
            <div class="rv-col rv-user-col">
              ${this.renderUserHeader('User In', model.stats.activeUserInputs, 32)}
              <div class="rv-user-strip">
                ${model.userInputs.map((slot) => this.renderUserRow(slot))}
              </div>
            </div>
            <div class="rv-col rv-processor-col">
              ${this.renderColumnHeader('Channels & Buses', model.stats.processors)}
              ${this.renderEndpointGroups(model.processors, 'processor')}
            </div>
            <div class="rv-col rv-user-col">
              ${this.renderUserHeader('User Out', model.stats.activeUserOutputs, 48)}
              <div class="rv-user-strip">
                ${model.userOutputs.map((slot) => this.renderUserRow(slot))}
              </div>
            </div>
            <div class="rv-col rv-output-col">
              ${this.renderColumnHeader('Outputs', model.stats.outputs)}
              ${this.renderEndpointGroups(model.outputs, 'output')}
            </div>
          </div>
        </div>
        ${this.renderLegend(model)}
      </section>
    `;
  }

  private renderNodeGraph(model: RoutingVisualModel) {
    const layout = buildNodeGraphLayout(model, this.nodeOverrides);
    return html`
      <section
        class=${classMap({
          'routing-visual': true,
          'routing-nodes': true,
          'highlight-active': this.hasHighlight(),
        })}
      >
        <header class="rv-node-bar">
          <span class="rv-brand">
            <span class="rv-version">V6</span>
            Routing · Node Graph
          </span>
          <span class="rv-crumbs">
            <strong>${this.filename}</strong>
            · ${model.stats.sources} sources →
            <span>${model.stats.activeUserInputs} UIN</span>
            → ${model.stats.processors} processors →
            <span>${model.stats.activeUserOutputs} UOUT</span>
            → ${model.stats.outputs} outputs
          </span>
          ${this.renderVisibilityToggle()}
        </header>

        <main class="rv-node-canvas">
          <div
            class="rv-node-stage rv-wire-stage"
            style=${`width: ${layout.width}px; height: ${layout.height}px;`}
            @click=${this.clearLockedHighlight}
          >
            <svg class="routing-wires" aria-hidden="true"></svg>
            ${layout.lanes.map(
              (lane) => html`
                <div
                  class=${classMap({
                    'rv-lane-label': true,
                    user: lane.label.includes('User Patch'),
                  })}
                  style=${`left: ${lane.x}px; top: ${NODE_GRAPH_LABEL_TOP}px;`}
                >
                  ${lane.label}
                </div>
              `,
            )}
            ${layout.nodes.map((node) => this.renderNodeGraphNode(node))}
          </div>
        </main>
      </section>
    `;
  }

  private renderPatchbayHeader(model: RoutingVisualModel) {
    return html`
      <header class="rv-patchbay-header">
        <h2>
          <span>V5</span>
          Routing · Patchbay
          <small>${this.filename}</small>
        </h2>
        <div class="rv-flow">
          <strong>${model.stats.sources} sources</strong>
          <span>→</span>
          <em>UIN ×${model.stats.activeUserInputs}</em>
          <span>→</span>
          ${model.stats.processors} processors
          <span>→</span>
          <em>UOUT ×${model.stats.activeUserOutputs}</em>
          <span>→</span>
          <strong>${model.stats.outputs} outputs</strong>
        </div>
        ${this.renderVisibilityToggle()}
      </header>
    `;
  }

  private renderVisibilityToggle() {
    return html`
      <label class="rv-visibility-toggle">
        <input
          type="checkbox"
          .checked=${this.includeHidden}
          @change=${this.onIncludeHiddenChange}
        />
        <span>Include hidden</span>
      </label>
    `;
  }

  private renderColumnHeader(label: string, count: number) {
    return html`
      <h3 class="rv-col-title">
        ${label}
        <span>${count}</span>
      </h3>
    `;
  }

  private renderUserHeader(label: string, active: number, total: number) {
    return html`
      <h3 class="rv-col-title">
        ${label}
        <span>${active}/${total}</span>
      </h3>
    `;
  }

  private renderEndpointGroups(
    endpoints: RoutingEndpoint[],
    kind: 'source' | 'processor' | 'output',
  ) {
    return groupBy(endpoints, (endpoint) => endpoint.group).map(
      ([group, items]) => html`
        <div class="rv-group">
          <div class="rv-group-name">${group}</div>
          ${items.map((endpoint) => this.renderEndpointRow(endpoint, kind))}
        </div>
      `,
    );
  }

  private renderEndpointRow(
    endpoint: RoutingEndpoint,
    kind: 'source' | 'processor' | 'output',
  ) {
    const styles = { '--rv-accent': endpoint.color };
    const pins = endpointPins(kind, endpoint.key);
    if (kind === 'source') {
      return html`
        <div
          class=${classMap({
            'rv-row': true,
            'rv-source-row': true,
            highlighted: this.isPinSetHighlighted(pins),
          })}
          style=${styleMap(styles)}
          @pointerenter=${() => this.setPreviewPins(pins)}
          @pointerleave=${this.clearPreviewHighlight}
          @click=${(event: Event) => this.lockPinSet(event, pins)}
        >
          <span class="rv-id">${endpoint.label}</span>
          ${this.renderName(endpoint)}
          <span class="rv-pin lit" data-pin=${sourceOutPin(endpoint.key)}></span>
        </div>
      `;
    }
    if (kind === 'output') {
      return html`
        <div
          class=${classMap({
            'rv-row': true,
            'rv-output-row': true,
            highlighted: this.isPinSetHighlighted(pins),
          })}
          style=${styleMap(styles)}
          @pointerenter=${() => this.setPreviewPins(pins)}
          @pointerleave=${this.clearPreviewHighlight}
          @click=${(event: Event) => this.lockPinSet(event, pins)}
        >
          <span class="rv-pin lit" data-pin=${outputInPin(endpoint.key)}></span>
          ${this.renderName(endpoint)}
          <span class="rv-id">${endpoint.label}</span>
        </div>
      `;
    }
    return html`
      <div
        class=${classMap({
          'rv-row': true,
          'rv-processor-row': true,
          highlighted: this.isPinSetHighlighted(pins),
        })}
        style=${styleMap(styles)}
        @pointerenter=${() => this.setPreviewPins(pins)}
        @pointerleave=${this.clearPreviewHighlight}
        @click=${(event: Event) => this.lockPinSet(event, pins)}
      >
        <span class="rv-pin lit" data-pin=${processorInPin(endpoint.key)}></span>
        <span class="rv-tab"></span>
        ${this.renderName(endpoint)}
        <span class="rv-pin lit" data-pin=${processorOutPin(endpoint.key)}></span>
      </div>
    `;
  }

  private renderName(endpoint: RoutingEndpoint) {
    return html`
      <span class="rv-name">
        ${endpoint.name || endpoint.label}
        ${endpoint.name && endpoint.label
          ? html`<span class="rv-meta">${endpoint.meta}</span>`
          : nothing}
      </span>
    `;
  }

  private renderUserRow(slot: UserRouteSlot) {
    const pins = [userInPin(slot.key), userOutPin(slot.key)];
    return html`
      <div
        class=${classMap({
          'rv-row': true,
          'rv-user-row': true,
          unused: !slot.active,
          highlighted: this.isPinSetHighlighted(pins),
        })}
        style=${styleMap({ '--rv-accent': slot.color })}
        @pointerenter=${() => this.setPreviewPins(pins)}
        @pointerleave=${this.clearPreviewHighlight}
        @click=${(event: Event) => this.lockPinSet(event, pins)}
      >
        <span
          class=${classMap({ 'rv-pin': true, lit: slot.active })}
          data-pin=${userInPin(slot.key)}
        ></span>
        <span class="rv-id">${slot.label}</span>
        <span
          class=${classMap({ 'rv-pin': true, lit: slot.active })}
          data-pin=${userOutPin(slot.key)}
        ></span>
      </div>
    `;
  }

  private renderNodeGraphNode(node: PositionedNode) {
    const accent =
      node.endpoints?.[0]?.color ?? node.slots?.find((slot) => slot.active)?.color ?? '#94a3b8';
    return html`
      <section
        class=${classMap({
          'rv-node': true,
          'rv-user-node': node.kind === 'user-patch',
          dragging: this.dragState?.id === node.id,
        })}
        data-kind=${node.kind}
        data-node-id=${node.id}
        style=${`left: ${node.x}px; top: ${node.y}px; --rv-accent: ${accent};`}
      >
        <header
          class="rv-node-head"
          @pointerdown=${(event: PointerEvent) =>
            this.startNodeDrag(event, node.id, { x: node.x, y: node.y })}
        >
          <span class="rv-node-dot"></span>
          ${node.title}
          <span class="rv-node-badge">${node.badge}</span>
        </header>
        <div class="rv-node-body">
          ${node.endpoints?.map((endpoint) =>
            this.renderNodePinRow(endpoint, nodeEndpointKind(node.kind)),
          )}
          ${node.slots?.map((slot) => this.renderUserNodeRow(slot))}
        </div>
      </section>
    `;
  }

  private renderNodePinRow(
    endpoint: RoutingEndpoint,
    kind: 'source' | 'processor' | 'output',
  ) {
    const styles = { '--rv-accent': endpoint.color };
    const pins = endpointPins(kind, endpoint.key);
    const label = html`
      <span class="rv-node-label">
        ${endpoint.label}
        ${endpoint.name ? html`<span>${endpoint.name}</span>` : nothing}
      </span>
    `;

    if (kind === 'source') {
      return html`
        <div
          class=${classMap({
            'rv-node-pin-row': true,
            'out-only': true,
            highlighted: this.isPinSetHighlighted(pins),
          })}
          style=${styleMap(styles)}
          @pointerenter=${() => this.setPreviewPins(pins)}
          @pointerleave=${this.clearPreviewHighlight}
          @click=${(event: Event) => this.lockPinSet(event, pins)}
        >
          ${label}
          <span class="rv-node-pin out lit" data-pin=${sourceOutPin(endpoint.key)}></span>
        </div>
      `;
    }
    if (kind === 'output') {
      return html`
        <div
          class=${classMap({
            'rv-node-pin-row': true,
            'in-only': true,
            highlighted: this.isPinSetHighlighted(pins),
          })}
          style=${styleMap(styles)}
          @pointerenter=${() => this.setPreviewPins(pins)}
          @pointerleave=${this.clearPreviewHighlight}
          @click=${(event: Event) => this.lockPinSet(event, pins)}
        >
          <span class="rv-node-pin in lit" data-pin=${outputInPin(endpoint.key)}></span>
          ${label}
        </div>
      `;
    }
    return html`
      <div
        class=${classMap({
          'rv-node-pin-row': true,
          both: true,
          highlighted: this.isPinSetHighlighted(pins),
        })}
        style=${styleMap(styles)}
        @pointerenter=${() => this.setPreviewPins(pins)}
        @pointerleave=${this.clearPreviewHighlight}
        @click=${(event: Event) => this.lockPinSet(event, pins)}
      >
        <span class="rv-node-pin in lit" data-pin=${processorInPin(endpoint.key)}></span>
        ${label}
        <span class="rv-node-pin out lit" data-pin=${processorOutPin(endpoint.key)}></span>
      </div>
    `;
  }

  private renderUserNodeRow(slot: UserRouteSlot) {
    const pins = [userInPin(slot.key), userOutPin(slot.key)];
    return html`
      <div
        class=${classMap({
          'rv-node-pin-row': true,
          both: true,
          unused: !slot.active,
          highlighted: this.isPinSetHighlighted(pins),
        })}
        style=${styleMap({ '--rv-accent': slot.color })}
        @pointerenter=${() => this.setPreviewPins(pins)}
        @pointerleave=${this.clearPreviewHighlight}
        @click=${(event: Event) => this.lockPinSet(event, pins)}
      >
        <span
          class=${classMap({ 'rv-node-pin': true, in: true, lit: slot.active })}
          data-pin=${userInPin(slot.key)}
        ></span>
        <span class="rv-node-label">
          ${slot.label}
          ${slot.meta ? html`<span>${slot.meta}</span>` : nothing}
        </span>
        <span
          class=${classMap({ 'rv-node-pin': true, out: true, lit: slot.active })}
          data-pin=${userOutPin(slot.key)}
        ></span>
      </div>
    `;
  }

  private renderLegend(model: RoutingVisualModel) {
    const colors = uniqueColors(model.connections).slice(0, 8);
    return html`
      <footer class="rv-legend">
        ${colors.map(
          (color) => html`
            <span>
              <i style=${styleMap({ '--rv-accent': color })}></i>
              ${colorLabel(color)}
            </span>
          `,
        )}
        <span class="rv-dashed"></span>
        <span>direct route bypasses user patch</span>
      </footer>
    `;
  }

  private scheduleDraw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.drawWires());
  }

  private drawWires(): void {
    const model = this.model;
    const stage = this.querySelector<HTMLElement>('.rv-wire-stage');
    const svg = this.querySelector<SVGSVGElement>('svg.routing-wires');
    if (!model || !stage || !svg) return;

    const stageRect = stage.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${stageRect.width} ${stageRect.height}`);
    svg.replaceChildren();

    const pins = new Map<string, HTMLElement>();
    this.querySelectorAll<HTMLElement>('[data-pin]').forEach((pin) => {
      const id = pin.dataset.pin;
      if (id) pins.set(id, pin);
    });

    const namespace = 'http://www.w3.org/2000/svg';
    for (const connection of model.connections) {
      const from = pins.get(connection.fromPin);
      const to = pins.get(connection.toPin);
      if (!from || !to) continue;

      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', wirePath(stageRect, from, to, this.mode));
      path.setAttribute(
        'class',
        connection.kind === 'bypass' ? 'rv-wire bypass' : 'rv-wire',
      );
      path.dataset.connection = connectionKey(connection);
      path.dataset.from = connection.fromPin;
      path.dataset.to = connection.toPin;
      path.setAttribute('stroke', connection.color);
      path.addEventListener('pointerenter', () => {
        this.previewConnection = connectionKey(connection);
      });
      path.addEventListener('pointerleave', () => {
        this.previewConnection = null;
      });
      path.addEventListener('click', (event) => {
        event.stopPropagation();
        this.lockedConnection =
          this.lockedConnection === connectionKey(connection)
            ? null
            : connectionKey(connection);
        this.lockedPins = [];
      });
      applyWireHighlight(path, connection, this.activeTracePinSet(), this.activeConnection());
      svg.appendChild(path);
    }
  }

  private setPreviewPins(pins: string[]): void {
    if (this.lockedConnection) return;
    this.previewPins = pins;
    this.previewConnection = null;
  }

  private clearPreviewHighlight = (): void => {
    this.previewPins = [];
    this.previewConnection = null;
  };

  private lockPinSet(event: Event, pins: string[]): void {
    event.stopPropagation();
    const next = samePins(this.lockedPins, pins) ? [] : pins;
    this.lockedPins = next;
    this.lockedConnection = null;
  }

  private clearLockedHighlight = (): void => {
    this.lockedPins = [];
    this.lockedConnection = null;
  };

  private startNodeDrag(
    event: PointerEvent,
    id: string,
    currentPosition: NodePoint,
  ): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.dragState = {
      id,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: currentPosition.x,
      startY: currentPosition.y,
    };
    window.addEventListener('pointermove', this.onNodeDragMove);
    window.addEventListener('pointerup', this.onNodeDragEnd);
  }

  private onNodeDragMove = (event: PointerEvent): void => {
    if (!this.dragState) return;
    const x = Math.max(
      16,
      this.dragState.startX + event.clientX - this.dragState.startPointerX,
    );
    const y = Math.max(
      NODE_GRAPH_TOP,
      this.dragState.startY + event.clientY - this.dragState.startPointerY,
    );
    this.nodeOverrides = {
      ...this.nodeOverrides,
      [this.dragState.id]: { x, y },
    };
    this.scheduleDraw();
  };

  private onNodeDragEnd = (): void => {
    this.dragState = null;
    window.removeEventListener('pointermove', this.onNodeDragMove);
    window.removeEventListener('pointerup', this.onNodeDragEnd);
  };

  private onIncludeHiddenChange = (event: Event): void => {
    this.includeHidden = (event.target as HTMLInputElement).checked;
    this.clearPreviewHighlight();
    this.clearLockedHighlight();
  };

  private activePinSet(): Set<string> {
    return new Set(this.lockedPins.length > 0 ? this.lockedPins : this.previewPins);
  }

  private activeTracePinSet(): Set<string> {
    if (!this.model || this.lockedPins.length === 0) return this.activePinSet();
    return expandTracePins(this.model, new Set(this.lockedPins));
  }

  private activeConnection(): string | null {
    return this.lockedConnection ?? this.previewConnection;
  }

  private hasHighlight(): boolean {
    return this.activePinSet().size > 0 || this.activeConnection() !== null;
  }

  private isPinSetHighlighted(pins: string[]): boolean {
    const active = this.activeTracePinSet();
    return active.size > 0 && pins.some((pin) => active.has(pin));
  }
}

function groupBy<T>(
  items: T[],
  keyFor: (item: T) => string,
): Array<[string, T[]]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()];
}

function wirePath(
  stageRect: DOMRect,
  from: HTMLElement,
  to: HTMLElement,
  mode: RoutingVisualMode,
): string {
  const a = pinCenter(stageRect, from);
  const b = pinCenter(stageRect, to);
  const span = Math.abs(b.x - a.x);
  const dx = Math.max(36, span * (mode === 'nodes' ? 0.45 : 0.5));
  const sag = mode === 'patchbay' ? Math.min(28, span * 0.04) : 0;
  return [
    `M ${a.x} ${a.y}`,
    `C ${a.x + dx} ${a.y + sag},`,
    `${b.x - dx} ${b.y + sag},`,
    `${b.x} ${b.y}`,
  ].join(' ');
}

function pinCenter(stageRect: DOMRect, pin: HTMLElement): { x: number; y: number } {
  const rect = pin.getBoundingClientRect();
  return {
    x: rect.left - stageRect.left + rect.width / 2,
    y: rect.top - stageRect.top + rect.height / 2,
  };
}

function uniqueColors(connections: RoutingConnection[]): string[] {
  return [...new Set(connections.map((connection) => connection.color))];
}

function endpointPins(
  kind: 'source' | 'processor' | 'output',
  key: string,
): string[] {
  if (kind === 'source') return [sourceOutPin(key)];
  if (kind === 'output') return [outputInPin(key)];
  return [processorInPin(key), processorOutPin(key)];
}

function nodeEndpointKind(
  kind: NodeGraphKind,
): 'source' | 'processor' | 'output' {
  if (kind === 'source' || kind === 'output') return kind;
  return 'processor';
}

function connectionKey(connection: RoutingConnection): string {
  return `${connection.fromPin}->${connection.toPin}`;
}

function applyWireHighlight(
  path: SVGPathElement,
  connection: RoutingConnection,
  activePins: Set<string>,
  activeConnection: string | null,
): void {
  const hasPinHighlight = activePins.size > 0;
  const hasConnectionHighlight = activeConnection !== null;
  const active =
    activeConnection === connectionKey(connection) ||
    (hasPinHighlight &&
      (activePins.has(connection.fromPin) || activePins.has(connection.toPin)));

  path.classList.toggle('active', active);
  path.classList.toggle('dimmed', (hasPinHighlight || hasConnectionHighlight) && !active);
}

function expandTracePins(
  model: RoutingVisualModel,
  selectedPins: Set<string>,
): Set<string> {
  if (selectedPins.size === 0) return selectedPins;

  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string): void => {
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };

  for (const connection of model.connections) {
    connect(connection.fromPin, connection.toPin);
  }
  for (const endpoint of model.processors) {
    connect(processorInPin(endpoint.key), processorOutPin(endpoint.key));
  }
  for (const slot of model.userInputs) {
    connect(userInPin(slot.key), userOutPin(slot.key));
  }
  for (const slot of model.userOutputs) {
    connect(userInPin(slot.key), userOutPin(slot.key));
  }

  const visited = new Set<string>();
  const queue = [...selectedPins];
  while (queue.length > 0) {
    const pin = queue.shift();
    if (!pin || visited.has(pin)) continue;
    visited.add(pin);
    for (const next of adjacency.get(pin) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function samePins(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((pin, index) => pin === b[index]);
}

function buildNodeGraphLayout(
  model: RoutingVisualModel,
  overrides: Record<string, NodePoint>,
): NodeGraphLayout {
  const nodes: NodeGraphNode[] = [];
  const pinToNode = new Map<string, string>();
  const pinOffsets = new Map<string, number>();
  let order = 0;

  for (const [group, endpoints] of groupBy(model.sources, (endpoint) => endpoint.group)) {
    const id = `source:${group}`;
    nodes.push({
      id,
      kind: 'source',
      title: group,
      badge: String(endpoints.length),
      rank: 0,
      naturalOrder: order++,
      rowCount: endpoints.length,
      endpoints,
    });
    endpoints.forEach((endpoint, index) => {
      const pin = sourceOutPin(endpoint.key);
      pinToNode.set(pin, id);
      pinOffsets.set(pin, nodeRowOffset(index));
    });
  }

  if (model.userInputs.length > 0) {
    const id = 'user-in';
    nodes.push({
      id,
      kind: 'user-patch',
      title: 'User Patch · IN',
      badge: `${model.stats.activeUserInputs}/32`,
      rank: 1,
      naturalOrder: order++,
      rowCount: model.userInputs.length,
      slots: model.userInputs,
    });
    model.userInputs.forEach((slot, index) => {
      pinToNode.set(userInPin(slot.key), id);
      pinToNode.set(userOutPin(slot.key), id);
      pinOffsets.set(userInPin(slot.key), nodeRowOffset(index));
      pinOffsets.set(userOutPin(slot.key), nodeRowOffset(index));
    });
  }

  for (const [group, endpoints] of groupBy(model.processors, (endpoint) => endpoint.group)) {
    const id = `processor:${group}`;
    nodes.push({
      id,
      kind: 'processor',
      title: group,
      badge: String(endpoints.length),
      rank: group === 'Out 1-16' ? 3 : 2,
      naturalOrder: order++,
      rowCount: endpoints.length,
      endpoints,
    });
    endpoints.forEach((endpoint, index) => {
      pinToNode.set(processorInPin(endpoint.key), id);
      pinToNode.set(processorOutPin(endpoint.key), id);
      pinOffsets.set(processorInPin(endpoint.key), nodeRowOffset(index));
      pinOffsets.set(processorOutPin(endpoint.key), nodeRowOffset(index));
    });
  }

  if (model.userOutputs.length > 0) {
    const id = 'user-out';
    nodes.push({
      id,
      kind: 'user-patch',
      title: 'User Patch · OUT',
      badge: `${model.stats.activeUserOutputs}/48`,
      rank: 4,
      naturalOrder: order++,
      rowCount: model.userOutputs.length,
      slots: model.userOutputs,
    });
    model.userOutputs.forEach((slot, index) => {
      pinToNode.set(userInPin(slot.key), id);
      pinToNode.set(userOutPin(slot.key), id);
      pinOffsets.set(userInPin(slot.key), nodeRowOffset(index));
      pinOffsets.set(userOutPin(slot.key), nodeRowOffset(index));
    });
  }

  for (const [group, endpoints] of groupBy(model.outputs, (endpoint) => endpoint.group)) {
    const id = `output:${group}`;
    nodes.push({
      id,
      kind: 'output',
      title: group,
      badge: String(endpoints.length),
      rank: 5,
      naturalOrder: order++,
      rowCount: endpoints.length,
      endpoints,
    });
    endpoints.forEach((endpoint, index) => {
      const pin = outputInPin(endpoint.key);
      pinToNode.set(pin, id);
      pinOffsets.set(pin, nodeRowOffset(index));
    });
  }

  const positioned: PositionedNode[] = nodes.map((node) => ({
    ...node,
    x: rankX(node.rank),
    y: NODE_GRAPH_TOP,
    height: estimateNodeHeight(node),
  }));
  if (positioned.length === 0) {
    return { nodes: [], lanes: [], width: 1200, height: 720 };
  }
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const edges = model.connections
    .map((connection) => ({
      from: pinToNode.get(connection.fromPin),
      to: pinToNode.get(connection.toPin),
      fromPin: connection.fromPin,
      toPin: connection.toPin,
    }))
    .filter((edge): edge is { from: string; to: string; fromPin: string; toPin: string } =>
      Boolean(edge.from && edge.to && edge.from !== edge.to),
    );

  for (const rank of uniqueRanks(positioned)) {
    packRank(
      positioned.filter((node) => node.rank === rank),
      new Map(),
    );
  }

  for (let pass = 0; pass < 5; pass += 1) {
    for (const rank of uniqueRanks(positioned).slice(1)) {
      packRank(
        positioned.filter((node) => node.rank === rank),
        desiredCenters(positioned, byId, edges, pinOffsets, rank, 'incoming'),
      );
    }
    for (const rank of uniqueRanks(positioned).slice(0, -1).reverse()) {
      packRank(
        positioned.filter((node) => node.rank === rank),
        desiredCenters(positioned, byId, edges, pinOffsets, rank, 'outgoing'),
      );
    }
  }

  normalizeAutoLayoutTop(positioned, overrides);

  for (const node of positioned) {
    const override = overrides[node.id];
    if (!override) continue;
    node.x = override.x;
    node.y = override.y;
  }

  const lanes = uniqueRanks(positioned).map((rank) => ({
    rank,
    x: rankX(rank),
    label: laneLabel(rank),
  }));
  const width = Math.max(
    1200,
    ...positioned.map((node) => node.x + estimatedNodeWidth(node) + 96),
  );
  const height = Math.max(
    720,
    ...positioned.map((node) => node.y + node.height + 96),
  );

  return { nodes: positioned, lanes, width, height };
}

function uniqueRanks(nodes: Array<{ rank: number }>): number[] {
  return [...new Set(nodes.map((node) => node.rank))].sort((a, b) => a - b);
}

function rankX(rank: number): number {
  return [48, 390, 700, 1040, 1360, 1680][rank] ?? 48 + rank * 320;
}

function laneLabel(rank: number): string {
  return [
    'Sources',
    'User Patch · IN',
    'Channels & Buses',
    'Out 1-16',
    'User Patch · OUT',
    'Outputs',
  ][rank] ?? 'Nodes';
}

function estimateNodeHeight(node: NodeGraphNode): number {
  return 42 + Math.max(1, node.rowCount) * 30 + 10;
}

function nodeRowOffset(index: number): number {
  return 42 + index * 30 + 15;
}

function estimatedNodeWidth(node: NodeGraphNode): number {
  if (node.kind === 'user-patch') return 240;
  if (node.kind === 'output') return 320;
  return 280;
}

function packRank(nodes: PositionedNode[], desiredCentersById: Map<string, number>): void {
  const sorted = [...nodes].sort((a, b) => {
    const desiredA = desiredCentersById.get(a.id);
    const desiredB = desiredCentersById.get(b.id);
    if (desiredA !== undefined && desiredB !== undefined) return desiredA - desiredB;
    if (desiredA !== undefined) return -1;
    if (desiredB !== undefined) return 1;
    return a.naturalOrder - b.naturalOrder;
  });

  let cursor = NODE_GRAPH_TOP;
  for (const node of sorted) {
    const desired = desiredCentersById.get(node.id);
    const targetTop = desired === undefined ? cursor : desired - node.height / 2;
    node.y = Math.max(cursor, targetTop);
    cursor = node.y + node.height + NODE_GRAPH_GAP;
  }
}

function normalizeAutoLayoutTop(
  nodes: PositionedNode[],
  overrides: Record<string, NodePoint>,
): void {
  const automaticNodes = nodes.filter((node) => !(node.id in overrides));
  if (automaticNodes.length === 0) return;

  const minY = Math.min(...automaticNodes.map((node) => node.y));
  const delta = minY - NODE_GRAPH_TOP;
  if (delta <= 0) return;

  for (const node of automaticNodes) {
    node.y -= delta;
  }
}

function desiredCenters(
  nodes: PositionedNode[],
  byId: Map<string, PositionedNode>,
  edges: Array<{ from: string; to: string; fromPin: string; toPin: string }>,
  pinOffsets: Map<string, number>,
  rank: number,
  direction: 'incoming' | 'outgoing',
): Map<string, number> {
  const centers = new Map<string, number[]>();
  const rankNodeIds = new Set(nodes.filter((node) => node.rank === rank).map((node) => node.id));

  for (const edge of edges) {
    const nodeId = direction === 'incoming' ? edge.to : edge.from;
    const neighborId = direction === 'incoming' ? edge.from : edge.to;
    if (!rankNodeIds.has(nodeId)) continue;
    const node = byId.get(nodeId);
    const neighbor = byId.get(neighborId);
    if (!node || !neighbor) continue;

    const ownPin = direction === 'incoming' ? edge.toPin : edge.fromPin;
    const neighborPin = direction === 'incoming' ? edge.fromPin : edge.toPin;
    const ownOffset = pinOffsets.get(ownPin) ?? node.height / 2;
    const neighborOffset = pinOffsets.get(neighborPin) ?? neighbor.height / 2;
    const desiredTop = neighbor.y + neighborOffset - ownOffset;
    (centers.get(nodeId) ?? centers.set(nodeId, []).get(nodeId)!).push(
      desiredTop + node.height / 2,
    );
  }

  return new Map(
    [...centers.entries()].map(([id, values]) => [
      id,
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ]),
  );
}

function colorLabel(color: string): string {
  const labels: Record<string, string> = {
    '#ef4444': 'red',
    '#d97706': 'yellow',
    '#16a34a': 'green',
    '#0891b2': 'cyan',
    '#2563eb': 'blue',
    '#c026d3': 'magenta',
    '#6b7280': 'white / neutral',
    '#64748b': 'internal',
    '#a1a1aa': 'uncolored',
  };
  return labels[color] ?? color;
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-routing-visualizer': RoutingVisualizer;
  }
}

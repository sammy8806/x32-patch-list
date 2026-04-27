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

@customElement('x32-routing-visualizer')
export class RoutingVisualizer extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) parser!: ScnParser;
  @property({ type: String }) mode: RoutingVisualMode = 'patchbay';
  @property({ type: String }) filename = '';

  @state() private previewPins: string[] = [];
  @state() private lockedPins: string[] = [];
  @state() private previewConnection: string | null = null;
  @state() private lockedConnection: string | null = null;

  private model: RoutingVisualModel | null = null;

  private frame = 0;
  private onWindowResize = () => this.scheduleDraw();

  override willUpdate(): void {
    this.model = this.parser ? buildRoutingVisualModel(this.parser) : null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('resize', this.onWindowResize);
  }

  override disconnectedCallback(): void {
    window.removeEventListener('resize', this.onWindowResize);
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
        </header>

        <main class="rv-node-canvas">
          <div class="rv-node-stage rv-wire-stage" @click=${this.clearLockedHighlight}>
            <svg class="routing-wires" aria-hidden="true"></svg>
            <div class="rv-node-column">
              <div class="rv-lane-label">Sources</div>
              ${this.renderNodeGroups(model.sources, 'source')}
            </div>
            <div class="rv-node-column rv-node-user">
              <div class="rv-lane-label user">User Patch · IN</div>
              ${this.renderUserNode('User Patch · IN', model.userInputs, model.stats.activeUserInputs, 32)}
            </div>
            <div class="rv-node-column rv-node-processors">
              <div class="rv-lane-label">Channels & Buses</div>
              ${this.renderNodeGroups(model.processors, 'processor')}
            </div>
            <div class="rv-node-column rv-node-user">
              <div class="rv-lane-label user">User Patch · OUT</div>
              ${this.renderUserNode('User Patch · OUT', model.userOutputs, model.stats.activeUserOutputs, 48)}
            </div>
            <div class="rv-node-column">
              <div class="rv-lane-label">Outputs</div>
              ${this.renderNodeGroups(model.outputs, 'output')}
            </div>
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
      </header>
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

  private renderNodeGroups(
    endpoints: RoutingEndpoint[],
    kind: 'source' | 'processor' | 'output',
  ) {
    return groupBy(endpoints, (endpoint) => endpoint.group).map(
      ([group, items]) => html`
        <section class="rv-node" data-kind=${kind}>
          <header class="rv-node-head">
            <span
              class="rv-node-dot"
              style=${styleMap({ '--rv-accent': items[0]?.color ?? '#94a3b8' })}
            ></span>
            ${group}
            <span class="rv-node-badge">${items.length}</span>
          </header>
          <div class="rv-node-body">
            ${items.map((endpoint) => this.renderNodePinRow(endpoint, kind))}
          </div>
        </section>
      `,
    );
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

  private renderUserNode(
    title: string,
    slots: UserRouteSlot[],
    active: number,
    total: number,
  ) {
    return html`
      <section class="rv-node rv-user-node" data-kind="user-patch">
        <header class="rv-node-head">
          <span class="rv-node-dot"></span>
          ${title}
          <span class="rv-node-badge">${active}/${total}</span>
        </header>
        <div class="rv-node-body">
          ${slots.map((slot) => this.renderUserNodeRow(slot))}
        </div>
      </section>
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
      applyWireHighlight(path, connection, this.activePinSet(), this.activeConnection());
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

  private activePinSet(): Set<string> {
    return new Set(this.lockedPins.length > 0 ? this.lockedPins : this.previewPins);
  }

  private activeConnection(): string | null {
    return this.lockedConnection ?? this.previewConnection;
  }

  private hasHighlight(): boolean {
    return this.activePinSet().size > 0 || this.activeConnection() !== null;
  }

  private isPinSetHighlighted(pins: string[]): boolean {
    const active = this.activePinSet();
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

function samePins(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((pin, index) => pin === b[index]);
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

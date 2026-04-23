/**
 * <x32-patch-table>
 *
 * Renders one patch-list table (input or output). Generated rows mirror the
 * Jinja templates in `legacy/templates/input_patch.html` and `output_patch.html`.
 *
 * Visibility toggles (per row and per section) work by adding the `ignore`
 * class — the same approach as the Python version — so the print stylesheet
 * keeps working untouched.
 *
 * Row text (source/destination + remarks) and visibility state are persisted
 * through the parent component's `<x32-app>` state; this component only
 * reports changes upwards via events.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ref, createRef, type Ref } from 'lit/directives/ref.js';
import type { Channel, P16OutputRow } from '../parser/types.js';
import type { ScnParser } from '../parser/scn-parser.js';
import { TYPE_NAMES } from '../parser/constants.js';
import { getDeskName, getSourceIndex } from '../parser/display.js';
import {
  computeSegments,
  gapKey,
  type Segment,
} from './table-segments.js';

/** Column count of an input/output patch table; kept in sync with the thead. */
const TABLE_COLSPAN = 8;

export type PatchTableVariant = 'input' | 'output';

export interface RowText {
  source?: string;
  remarks?: string;
}

@customElement('x32-patch-table')
export class PatchTable extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) parser!: ScnParser;
  @property({ type: String }) variant: PatchTableVariant = 'input';
  @property({ type: String }) patchType = 'in';
  @property({ attribute: false }) rowText: Record<string, RowText> = {};
  @property({ attribute: false }) visibleRows: Record<string, boolean> = {};
  @property({ attribute: false }) visibleSections: Record<string, boolean> = {};
  @property({ attribute: false }) collapsedGaps: Record<string, boolean> = {};

  @state() private sectionKey = '';

  private onWindowResize = () => this.resizeAllTextareas();

  override willUpdate(): void {
    this.sectionKey = `${this.variant}:${this.patchType}`;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('resize', this.onWindowResize);
  }

  override disconnectedCallback(): void {
    window.removeEventListener('resize', this.onWindowResize);
    super.disconnectedCallback();
  }

  /**
   * Resizes every textarea in this table to fit its content.
   *
   * Called from `updated()` (so it fires on first paint and on every state
   * change — e.g. when `rowText` is restored from storage on reload) and
   * from the window resize listener (so layout-width changes reflow too).
   *
   * Without this, textareas stay at their CSS default of `height: 1em` +
   * `overflow: hidden` and clip multi-line content.
   */
  private resizeAllTextareas(): void {
    this.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(autoResize);
  }

  override updated(): void {
    this.resizeAllTextareas();
  }

  // ---------------- Key helpers ----------------

  private rowKey(lineIndex: number, subIndex = 0): string {
    return `${this.variant}:${this.patchType}:${lineIndex}:${subIndex}`;
  }

  private isRowVisible(key: string, defaultVisible: boolean): boolean {
    return key in this.visibleRows ? this.visibleRows[key] : defaultVisible;
  }

  private isSectionVisible(defaultVisible: boolean): boolean {
    return this.sectionKey in this.visibleSections
      ? this.visibleSections[this.sectionKey]
      : defaultVisible;
  }

  /**
   * Collapsible gaps default to collapsed. Only explicit user choices are
   * stored — `true` keeps it collapsed, `false` means user expanded it.
   */
  private isGapCollapsed(key: string): boolean {
    return key in this.collapsedGaps ? this.collapsedGaps[key] : true;
  }

  // ---------------- Event helpers ----------------

  private emitRowText(key: string, field: 'source' | 'remarks', value: string): void {
    this.dispatchEvent(
      new CustomEvent('row-text-change', {
        detail: { key, field, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private emitRowVisibility(key: string, visible: boolean): void {
    this.dispatchEvent(
      new CustomEvent('row-visibility-change', {
        detail: { key, visible },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private emitSectionVisibility(visible: boolean): void {
    this.dispatchEvent(
      new CustomEvent('section-visibility-change', {
        detail: { key: this.sectionKey, visible },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private emitGapCollapse(key: string, collapsed: boolean): void {
    this.dispatchEvent(
      new CustomEvent('gap-collapse-change', {
        detail: { key, collapsed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------- Render ----------------

  override render() {
    if (this.variant === 'input') return this.renderInput();
    return this.renderOutput();
  }

  private renderInput() {
    const rows = this.parser.getChannelListForType(this.patchType);
    const defaultSectionVisible = this.parser.hasTypeAnythingAssigned(rows);
    const sectionVisible = this.isSectionVisible(defaultSectionVisible);
    const label = TYPE_NAMES[this.patchType] ?? this.patchType;
    const segments = computeSegments(rows);

    return html`
      <table
        class=${classMap({ patch: true, ignore: !sectionVisible })}
      >
        <caption>
          ${label} Input Patch List
          <input
            type="checkbox"
            class="togglesection"
            .checked=${sectionVisible}
            @change=${(e: Event) =>
              this.emitSectionVisibility((e.target as HTMLInputElement).checked)}
          />
        </caption>
        <thead>
          <tr>
            <th>Input</th>
            <th>Channel</th>
            <th>User Route</th>
            <th></th>
            <th>Name</th>
            <th>Source</th>
            <th>Remarks</th>
            <th>
              <input
                type="checkbox"
                class="togglechildren"
                checked
                @change=${this.onToggleAllRows}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          ${segments.flatMap((segment) =>
            this.renderSegment(segment, (row, lineIndex, extraClasses) =>
              this.renderInputRowGroup(
                row as Channel[] | null,
                lineIndex,
                extraClasses,
              ),
            ),
          )}
        </tbody>
      </table>
    `;
  }

  private renderInputRowGroup(
    row: Channel[] | null,
    lineIndex: number,
    extraClasses: Record<string, boolean> = {},
  ) {
    const group = row ?? [null as Channel | null];
    const parity = lineIndex % 2 === 0 ? 'odd' : 'even';

    return group.map((chan, subIndex) => {
      const key = this.rowKey(lineIndex, subIndex);
      const rowText = this.rowText[key] ?? {};
      const defaultVisible = chan !== null;
      const visible = this.isRowVisible(key, defaultVisible);

      const userRouteKey = this.parser.getInputUserRoutePosition(
        `${this.patchType}.${String(lineIndex + 1).padStart(2, '0')}`,
      );
      const userRouteCell = renderUserRouteCell(userRouteKey);

      return html`
        <tr class=${classMap({ [parity]: true, ignore: !visible, ...extraClasses })}>
          <td>${subIndex === 0 ? getSourceIndex(this.patchType, lineIndex + 1) : ''}</td>
          <td>${getDeskName(chan)}</td>
          ${userRouteCell}
          <td class=${`colour col-${chan?.color ?? 'OFF'}`}></td>
          <td>${chan?.name ?? ''}</td>
          ${this.renderTextCell(key, 'source', rowText.source ?? '')}
          ${this.renderTextCell(key, 'remarks', rowText.remarks ?? '')}
          <td>
            <input
              type="checkbox"
              class="togglevisible"
              tabindex="-1"
              title="Show"
              .checked=${visible}
              @change=${(e: Event) =>
                this.emitRowVisibility(key, (e.target as HTMLInputElement).checked)}
            />
          </td>
        </tr>
      `;
    });
  }

  private renderOutput() {
    const rows = this.parser.getOutputListForType(this.patchType);
    const defaultSectionVisible = this.parser.hasTypeAnythingAssigned(rows);
    const sectionVisible = this.isSectionVisible(defaultSectionVisible);
    const label = TYPE_NAMES[this.patchType] ?? this.patchType;
    const segments = computeSegments(rows);

    return html`
      <table
        class=${classMap({ patch: true, ignore: !sectionVisible })}
      >
        <caption>
          ${label} Output Patch List
          <input
            type="checkbox"
            class="togglesection"
            .checked=${sectionVisible}
            @change=${(e: Event) =>
              this.emitSectionVisibility((e.target as HTMLInputElement).checked)}
          />
        </caption>
        <thead>
          <tr>
            <th>Output</th>
            <th>Source</th>
            <th>User Route</th>
            <th></th>
            <th>Name</th>
            <th>Destination</th>
            <th>Remarks</th>
            <th>
              <input
                type="checkbox"
                class="togglechildren"
                @change=${this.onToggleAllRows}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          ${segments.flatMap((segment) =>
            this.renderSegment(segment, (row, lineIndex, extraClasses) =>
              [
                this.renderOutputRow(
                  row as Channel | P16OutputRow | null,
                  lineIndex,
                  extraClasses,
                ),
              ],
            ),
          )}
        </tbody>
      </table>
    `;
  }

  private renderOutputRow(
    row: Channel | P16OutputRow | null,
    lineIndex: number,
    extraClasses: Record<string, boolean> = {},
  ) {
    const parity = lineIndex % 2 === 0 ? 'odd' : 'even';
    const key = this.rowKey(lineIndex);
    const rowText = this.rowText[key] ?? {};
    const channel = row && !(row as P16OutputRow).p16 ? (row as Channel) : null;

    if (row && (row as P16OutputRow).p16) {
      const visible = this.isRowVisible(key, false);
      return html`
        <tr class=${classMap({ [parity]: true, ignore: !visible, ...extraClasses })}>
          <td>${lineIndex + 1}</td>
          <td></td>
          <td></td>
          <td class="colour col-OFF"></td>
          <td>Ultranet</td>
          <td></td>
          <td></td>
          <td>
            <input
              type="checkbox"
              class="togglevisible"
              tabindex="-1"
              title="Show"
              .checked=${visible}
              @change=${(e: Event) =>
                this.emitRowVisibility(key, (e.target as HTMLInputElement).checked)}
            />
          </td>
        </tr>
      `;
    }

    const defaultVisible = row !== null;
    const visible = this.isRowVisible(key, defaultVisible);
    const userRouteKey = this.parser.getOutputUserRoutePosition(
      `${this.patchType}.${String(lineIndex + 1).padStart(2, '0')}`,
    );

    return html`
      <tr class=${classMap({ [parity]: true, ignore: !visible, ...extraClasses })}>
        <td>${lineIndex + 1}</td>
        <td>${getDeskName(channel)}</td>
        ${renderUserRouteCell(userRouteKey)}
        <td class=${`colour col-${channel?.color ?? 'OFF'}`}></td>
        <td>${channel?.name ?? ''}</td>
        ${this.renderTextCell(key, 'source', rowText.source ?? '')}
        ${this.renderTextCell(key, 'remarks', rowText.remarks ?? '')}
        <td>
          <input
            type="checkbox"
            class="togglevisible"
            tabindex="-1"
            title="Show"
            .checked=${visible}
            @change=${(e: Event) =>
              this.emitRowVisibility(key, (e.target as HTMLInputElement).checked)}
          />
        </td>
      </tr>
    `;
  }

  /**
   * Render one segment from `computeSegments`. Data segments just delegate to
   * `renderRow`. Gap segments always render their empty rows into the DOM
   * (so `print.css` can let them through losslessly) and — when collapsible —
   * add a clickable bar plus a `.gap-collapsed` class on the hidden rows when
   * the user hasn't expanded them.
   */
  private renderSegment<T>(
    segment: Segment<T>,
    renderRow: (
      row: T | null,
      lineIndex: number,
      extraClasses?: Record<string, boolean>,
    ) => unknown,
  ): unknown[] {
    if (segment.kind === 'data') {
      return segment.rows.map((row, offset) =>
        renderRow(row, segment.start + offset),
      );
    }

    if (!segment.collapsible) {
      const out: unknown[] = [];
      for (let i = segment.start; i <= segment.end; i += 1) {
        out.push(renderRow(null as T | null, i));
      }
      return out;
    }

    const key = gapKey(this.variant, this.patchType, segment);
    const collapsed = this.isGapCollapsed(key);
    const out: unknown[] = [this.renderGapBar(segment, key, collapsed)];
    for (let i = segment.start; i <= segment.end; i += 1) {
      out.push(renderRow(null as T | null, i, { 'gap-collapsed': collapsed }));
    }
    return out;
  }

  private renderGapBar(
    segment: Extract<Segment<unknown>, { kind: 'gap' }>,
    key: string,
    collapsed: boolean,
  ): TemplateResult {
    const countLabel =
      segment.count === 1 ? '1 empty row' : `${segment.count} empty rows`;
    const title = collapsed
      ? `Expand ${countLabel}`
      : `Collapse ${countLabel}`;
    return html`
      <tr
        class=${classMap({
          'gap-bar': true,
          'gap-bar-collapsed': collapsed,
          'gap-bar-expanded': !collapsed,
        })}
        title=${title}
        @click=${() => this.emitGapCollapse(key, !collapsed)}
      >
        <td colspan=${TABLE_COLSPAN}>
          <span class="gap-chevron" aria-hidden="true">${collapsed ? '▸' : '▾'}</span>
          <span class="gap-count">${countLabel}</span>
        </td>
      </tr>
    `;
  }

  private renderTextCell(
    key: string,
    field: 'source' | 'remarks',
    value: string,
  ) {
    const taRef: Ref<HTMLTextAreaElement> = createRef();
    return html`
      <td>
        <textarea
          ${ref(taRef)}
          .value=${value}
          name=${field}
          @input=${(e: Event) => {
            const el = e.target as HTMLTextAreaElement;
            autoResize(el);
            this.emitRowText(key, field, el.value);
          }}
          @focusin=${(e: Event) => autoResize(e.target as HTMLTextAreaElement)}
        ></textarea>
      </td>
    `;
  }

  private onToggleAllRows = (e: Event) => {
    const checked = (e.target as HTMLInputElement).checked;
    const rowKeys =
      this.variant === 'input'
        ? this.collectInputRowKeys()
        : this.collectOutputRowKeys();
    this.dispatchEvent(
      new CustomEvent('toggle-all-rows', {
        detail: {
          sectionKey: this.sectionKey,
          visible: checked,
          rowKeys,
        },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private collectInputRowKeys(): string[] {
    const keys: string[] = [];
    const rows = this.parser.getChannelListForType(this.patchType);
    rows.forEach((row, lineIndex) => {
      const group = row ?? [null];
      group.forEach((_, subIndex) => keys.push(this.rowKey(lineIndex, subIndex)));
    });
    return keys;
  }

  private collectOutputRowKeys(): string[] {
    const rows = this.parser.getOutputListForType(this.patchType);
    return rows.map((_, lineIndex) => this.rowKey(lineIndex));
  }
}

function renderUserRouteCell(userRouteKey: string | null) {
  if (!userRouteKey) return html`<td></td>`;
  const parts = userRouteKey.split('.');
  const userRoutePos = parts[1] ?? '';
  const userRouteType = userRouteKey.includes('in') ? 'I' : 'O';
  const text = userRoutePos ? `${userRouteType}-${userRoutePos}` : '';
  return html`<td>${text}</td>`;
}

function autoResize(el: HTMLTextAreaElement): void {
  el.style.height = '1em';
  el.style.height = `${el.scrollHeight}px`;
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-patch-table': PatchTable;
  }
}

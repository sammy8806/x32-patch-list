/**
 * <x32-patch-list>
 *
 * Thin dispatcher that renders the input tables followed by the output
 * tables. All the real work lives in <x32-patch-table>.
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ScnParser } from '../parser/scn-parser.js';
import {
  INPUT_TABLE_TYPES,
  OUTPUT_TABLE_TYPES,
} from '../parser/constants.js';
import './patch-table.js';
import type { RowText } from './patch-table.js';

@customElement('x32-patch-list')
export class PatchList extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) parser!: ScnParser;
  @property({ type: String }) override title = '';
  @property({ type: String }) originalFileName = '';
  @property({ attribute: false }) rowText: Record<string, RowText> = {};
  @property({ attribute: false }) visibleRows: Record<string, boolean> = {};
  @property({ attribute: false }) visibleSections: Record<string, boolean> = {};

  override render() {
    return html`
      <div class="details">
        <h1 id="title">${this.title}</h1>
        <textarea
          rows="10"
          placeholder=${this.originalFileName}
        ></textarea>
      </div>

      ${INPUT_TABLE_TYPES.map(
        (type) => html`
          <x32-patch-table
            .parser=${this.parser}
            variant="input"
            .patchType=${type}
            .rowText=${this.rowText}
            .visibleRows=${this.visibleRows}
            .visibleSections=${this.visibleSections}
          ></x32-patch-table>
        `,
      )}

      ${OUTPUT_TABLE_TYPES.map(
        (type) => html`
          <x32-patch-table
            .parser=${this.parser}
            variant="output"
            .patchType=${type}
            .rowText=${this.rowText}
            .visibleRows=${this.visibleRows}
            .visibleSections=${this.visibleSections}
          ></x32-patch-table>
        `,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-patch-list': PatchList;
  }
}

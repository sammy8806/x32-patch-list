/**
 * <x32-toolbar>
 *
 * Sticky top bar shown once a scene is loaded. Contains:
 *   - filename label (click to pick a different file)
 *   - title input (wide)
 *   - Migrate Comments
 *   - Export JSON
 *   - Print
 *
 * Emits: `title-changed` (detail: string), `request-new-file`,
 * `view-changed` (detail: AppViewMode), `request-comment-migration`,
 * `export-json`, `print`.
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

import type { AppViewMode } from '../url-state.js';

const VIEW_OPTIONS: Array<{ mode: AppViewMode; label: string }> = [
  { mode: 'list', label: 'Patch List' },
  { mode: 'patchbay', label: 'Patchbay' },
  { mode: 'nodes', label: 'Node Graph' },
];

@customElement('x32-toolbar')
export class Toolbar extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ type: String }) filename = '';
  @property({ type: String }) override title = '';
  @property({ type: String }) viewMode: AppViewMode = 'list';

  override render() {
    return html`
      <div class="shell-toolbar">
        <div class="filename" title=${this.filename}>
          <button
            type="button"
            @click=${() => this.emit('request-new-file')}
          >${this.filename || 'Load file…'}</button>
        </div>
        <input
          type="text"
          name="title"
          placeholder="Title…"
          .value=${this.title}
          @input=${this.onTitleInput}
        />
        <div class="view-switch" role="group" aria-label="View">
          ${VIEW_OPTIONS.map(
            (option) => html`
              <button
                type="button"
                class=${classMap({ active: this.viewMode === option.mode })}
                aria-pressed=${this.viewMode === option.mode}
                @click=${() => this.emitView(option.mode)}
              >
                ${option.label}
              </button>
            `,
          )}
        </div>
        <button
          type="button"
          @click=${() => this.emit('request-comment-migration')}
        >
          Migrate Comments
        </button>
        <button type="button" @click=${() => this.emit('export-json')}>
          Export JSON
        </button>
        <button
          type="button"
          class="primary"
          @click=${() => this.emit('print')}
        >
          Print
        </button>
      </div>
    `;
  }

  private onTitleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    this.dispatchEvent(
      new CustomEvent('title-changed', {
        detail: value,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private emitView(mode: AppViewMode): void {
    this.dispatchEvent(
      new CustomEvent('view-changed', {
        detail: mode,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-toolbar': Toolbar;
  }
}

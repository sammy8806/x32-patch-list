/**
 * <x32-upload>
 *
 * Start screen: command-palette-style card with keyboard nav and drag-drop.
 * Emits a `scene-selected` custom event with `{ text, filename, size }` once
 * the user picks a file (via click, Enter, or drop).
 *
 * Keyboard model
 *   ↑ / ↓   move selection between items (wraps)
 *   Enter   activate the highlighted item
 *   Esc     reset selection to the first item and blur the card
 *   Home/End jump to first / last
 *
 * Recent files are shown only when storage has at least one prior session.
 * Until scene contents are persisted, activating a recent entry opens the
 * file picker just like "Open" — the filename is a memory aid, not a handle.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { RecentFile } from '../storage.js';

export interface SceneSelectedDetail {
  text: string;
  filename: string;
  size: number;
}

type Item =
  | { kind: 'open' }
  | { kind: 'recent'; recent: RecentFile };

@customElement('x32-upload')
export class UploadView extends LitElement {
  // Render into light DOM so the global stylesheet applies.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) recentFiles: RecentFile[] = [];

  @state() private dragOver = false;
  @state() private errorMessage: string | null = null;
  @state() private activeIndex = 0;

  /** Flat list in render order; keyboard index refers to this. */
  private get items(): Item[] {
    return [
      { kind: 'open' },
      ...this.recentFiles.map<Item>((recent) => ({ kind: 'recent', recent })),
    ];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Global keydown while the start screen is mounted. No element focus
    // required → no focus ring on mount, and no interference with anything
    // else once a scene is loaded (the listener is removed on unmount).
    window.addEventListener('keydown', this.onKeyDown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKeyDown);
  }

  override render() {
    const hasRecents = this.recentFiles.length > 0;

    return html`
      <div
        class="start"
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <div class="start-main">
          <h1>Open a scene file</h1>
          <p class="lede">
            Drop a <code>.scn</code> anywhere on this card, or pick an action below.
          </p>

          <div
            class="cmd ${this.dragOver ? 'drag' : ''}"
            role="listbox"
            aria-label="Open scene file"
          >
            <div class="cmd-group">
              <div class="cmd-label">Actions</div>
              ${this.renderItem(0, {
                label: 'Open scene file from disk',
                hint: 'Enter',
                icon: iconFile,
              })}

              ${hasRecents
                ? html`
                    <div class="cmd-sep"></div>
                    <div class="cmd-label">Recent</div>
                    ${this.recentFiles.map((r, i) =>
                      this.renderItem(1 + i, {
                        label: r.filename,
                        hint: 'Enter',
                        icon: iconClock,
                      }),
                    )}
                  `
                : nothing}
            </div>

            <input
              type="file"
              accept=".scn,text/plain"
              id="picker"
              @change=${this.onChange}
            />

            <div class="cmd-footer">
              <span>Runs locally · nothing is uploaded</span>
              <span class="keys">
                <span><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span>
                <span><span class="kbd">↵</span> select</span>
                <span><span class="kbd">esc</span> clear</span>
              </span>
            </div>
          </div>

          ${this.errorMessage
            ? html`<p class="error">${this.errorMessage}</p>`
            : nothing}
        </div>
      </div>
    `;
  }

  // ---------------- rendering helpers ----------------

  private renderItem(
    index: number,
    opts: { label: string; hint: string; icon: ReturnType<typeof html> },
  ) {
    const active = this.activeIndex === index;
    return html`
      <div
        class="cmd-item ${active ? 'active' : ''}"
        role="option"
        aria-selected=${active ? 'true' : 'false'}
        @click=${() => this.activateItem(index)}
        @mouseenter=${() => {
          this.activeIndex = index;
        }}
      >
        ${opts.icon} ${opts.label}
        <span class="hint">${opts.hint}</span>
      </div>
    `;
  }

  // ---------------- interaction ----------------

  private onKeyDown = (e: KeyboardEvent) => {
    const count = this.items.length;
    if (count === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.activeIndex = (this.activeIndex + 1) % count;
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.activeIndex = (this.activeIndex - 1 + count) % count;
        break;
      case 'Home':
        e.preventDefault();
        this.activeIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        this.activeIndex = count - 1;
        break;
      case 'Enter':
        e.preventDefault();
        this.activateItem(this.activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        this.activeIndex = 0;
        break;
    }
  };

  private activateItem(index: number): void {
    const item = this.items[index];
    if (!item) return;
    this.activeIndex = index;
    // Both "Open" and recent entries currently open the file picker.
    // When content storage lands, `item.kind === 'recent'` will branch into
    // a direct reopen path.
    this.pickerEl?.click();
  }

  private onDragOver = (e: DragEvent) => {
    e.preventDefault();
    this.dragOver = true;
  };

  private onDragLeave = () => {
    this.dragOver = false;
  };

  private onDrop = async (e: DragEvent) => {
    e.preventDefault();
    this.dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) await this.handleFile(file);
  };

  private onChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.handleFile(file);
    // Allow the same file to be picked again later (browsers suppress
    // `change` events when the selected path is unchanged).
    input.value = '';
  };

  private async handleFile(file: File): Promise<void> {
    this.errorMessage = null;
    try {
      const text = await file.text();
      this.dispatchEvent(
        new CustomEvent<SceneSelectedDetail>('scene-selected', {
          detail: { text, filename: file.name, size: file.size },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.errorMessage = `Could not read file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ---------------- DOM refs ----------------

  private get pickerEl(): HTMLInputElement | null {
    return this.querySelector<HTMLInputElement>('#picker');
  }
}

// ---------------- icons ----------------

const iconFile = html`
  <svg
    class="ico"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
  </svg>
`;

const iconClock = html`
  <svg
    class="ico"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
`;

declare global {
  interface HTMLElementTagNameMap {
    'x32-upload': UploadView;
  }
}

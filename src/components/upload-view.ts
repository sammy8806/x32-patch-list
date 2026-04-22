/**
 * <x32-upload>
 *
 * Landing-page file picker + drag-and-drop. Emits a `scene-selected` custom
 * event with `{ text, filename, size }` once the user picks a file.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface SceneSelectedDetail {
  text: string;
  filename: string;
  size: number;
}

@customElement('x32-upload')
export class UploadView extends LitElement {
  // Render into light DOM so the global stylesheet applies.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ type: String }) lastFilename: string | null = null;
  @state() private dragOver = false;
  @state() private errorMessage: string | null = null;

  override render() {
    return html`
      <div
        class="upload ${this.dragOver ? 'drag-over' : ''}"
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <h1>X32 Patch List Creator</h1>
        <p>Select or drop an X32 scene file to generate a printable patch list.</p>
        <input
          type="file"
          accept=".scn,text/plain"
          @change=${this.onChange}
        />
        ${this.lastFilename
          ? html`<p class="hint">Last file: <strong>${this.lastFilename}</strong></p>`
          : nothing}
        ${this.errorMessage
          ? html`<p class="error">${this.errorMessage}</p>`
          : nothing}
        <p class="hint">
          Everything runs in your browser. No file is uploaded anywhere.
        </p>
      </div>
    `;
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
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-upload': UploadView;
  }
}

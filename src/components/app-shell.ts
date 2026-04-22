/**
 * <x32-app>
 *
 * Top-level component. Owns parsed state + persisted state and wires events
 * from the upload view, toolbar, and patch tables.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import './upload-view.js';
import './toolbar.js';
import './patch-list.js';
import type { SceneSelectedDetail } from './upload-view.js';

import { ScnParser } from '../parser/scn-parser.js';
import {
  lastFilename,
  loadSession,
  makeEmptyState,
  saveSession,
  sessionIdFor,
  type SessionState,
} from '../storage.js';

type RowTextFieldChange = {
  key: string;
  field: 'source' | 'remarks';
  value: string;
};

@customElement('x32-app')
export class AppShell extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @state() private parser: ScnParser | null = null;
  @state() private session: SessionState | null = null;
  @state() private sessionId: string | null = null;
  @state() private lastFilenameHint: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.lastFilenameHint = lastFilename();

    this.addEventListener('scene-selected', this.onSceneSelected as EventListener);
    this.addEventListener('title-changed', this.onTitleChanged as EventListener);
    this.addEventListener('request-new-file', this.onRequestNewFile);
    this.addEventListener('export-json', this.onExportJson);
    this.addEventListener('print', this.onPrint);
    this.addEventListener('row-text-change', this.onRowTextChange as EventListener);
    this.addEventListener(
      'row-visibility-change',
      this.onRowVisibilityChange as EventListener,
    );
    this.addEventListener(
      'section-visibility-change',
      this.onSectionVisibilityChange as EventListener,
    );
    this.addEventListener('toggle-all-rows', this.onToggleAllRows as EventListener);
  }

  override render() {
    if (!this.parser || !this.session) {
      return html`
        <div class="shell">
          <main class="shell-main">
            <x32-upload .lastFilename=${this.lastFilenameHint}></x32-upload>
          </main>
        </div>
      `;
    }

    return html`
      <div class="shell">
        <header class="shell-header">
          <x32-toolbar
            .filename=${this.session.filename}
            .title=${this.session.title}
          ></x32-toolbar>
        </header>
        <main class="shell-main">
          <x32-patch-list
            .parser=${this.parser}
            .title=${this.session.title}
            .originalFileName=${this.session.filename}
            .rowText=${this.session.rowText}
            .visibleRows=${this.session.visibleRows}
            .visibleSections=${this.session.visibleSections}
          ></x32-patch-list>
        </main>
      </div>
      ${nothing}
    `;
  }

  // ---------------- Event handlers ----------------

  private onSceneSelected = (e: CustomEvent<SceneSelectedDetail>) => {
    const { text, filename, size } = e.detail;
    const parser = new ScnParser();
    parser.parseText(text);
    this.parser = parser;
    const id = sessionIdFor(filename, size);
    this.sessionId = id;
    this.session = loadSession(id) ?? makeEmptyState(filename);
    this.persist();
  };

  private onTitleChanged = (e: CustomEvent<string>) => {
    this.mutateSession((s) => {
      s.title = e.detail;
    });
  };

  private onRequestNewFile = () => {
    this.parser = null;
    this.session = null;
    this.sessionId = null;
  };

  private onExportJson = () => {
    if (!this.parser || !this.session) return;
    const payload = {
      filename: this.session.filename,
      title: this.session.title,
      routingSwitch: this.parser.routingSwitch,
      channels: this.parser.channels,
      route: this.parser.route,
      outputs: this.parser.outputs,
      userRouteByName: this.parser.userRouteByName,
      rowText: this.session.rowText,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.session.filename.replace(/\.[^./]+$/, '')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  private onPrint = () => {
    window.print();
  };

  private onRowTextChange = (e: CustomEvent<RowTextFieldChange>) => {
    const { key, field, value } = e.detail;
    this.mutateSession((s) => {
      const existing = s.rowText[key] ?? {};
      s.rowText = { ...s.rowText, [key]: { ...existing, [field]: value } };
    });
  };

  private onRowVisibilityChange = (
    e: CustomEvent<{ key: string; visible: boolean }>,
  ) => {
    const { key, visible } = e.detail;
    this.mutateSession((s) => {
      s.visibleRows = { ...s.visibleRows, [key]: visible };
    });
  };

  private onSectionVisibilityChange = (
    e: CustomEvent<{ key: string; visible: boolean }>,
  ) => {
    const { key, visible } = e.detail;
    this.mutateSession((s) => {
      s.visibleSections = { ...s.visibleSections, [key]: visible };
    });
  };

  private onToggleAllRows = (
    e: CustomEvent<{ sectionKey: string; visible: boolean; rowKeys: string[] }>,
  ) => {
    const { visible, rowKeys } = e.detail;
    this.mutateSession((s) => {
      const next = { ...s.visibleRows };
      for (const k of rowKeys) next[k] = visible;
      s.visibleRows = next;
    });
  };

  // ---------------- State helpers ----------------

  private mutateSession(mutator: (s: SessionState) => void): void {
    if (!this.session) return;
    const next: SessionState = {
      ...this.session,
      rowText: { ...this.session.rowText },
      visibleRows: { ...this.session.visibleRows },
      visibleSections: { ...this.session.visibleSections },
    };
    mutator(next);
    this.session = next;
    this.persist();
  }

  private persist(): void {
    if (this.sessionId && this.session) {
      saveSession(this.sessionId, this.session);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-app': AppShell;
  }
}

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
import type {
  RecentSelectedDetail,
  SceneSelectedDetail,
} from './upload-view.js';

import { ScnParser } from '../parser/scn-parser.js';
import {
  findCachedScenesByFilename,
  loadScene,
  loadSession,
  makeEmptyState,
  recentFiles,
  saveSession,
  sessionIdFor,
  type RecentFile,
  type SessionState,
} from '../storage.js';
import {
  nextHrefForSession,
  readSessionIdFromHref,
} from '../url-state.js';

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
  @state() private recentFilesList: RecentFile[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    this.recentFilesList = recentFiles();

    this.addEventListener('scene-selected', this.onSceneSelected as EventListener);
    this.addEventListener('recent-selected', this.onRecentSelected as EventListener);
    this.addEventListener('title-changed', this.onTitleChanged as EventListener);
    this.addEventListener('sheet-notes-changed', this.onSheetNotesChanged as EventListener);
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
    window.addEventListener('popstate', this.onPopState);
    this.restoreInitialSession();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('scene-selected', this.onSceneSelected as EventListener);
    this.removeEventListener('recent-selected', this.onRecentSelected as EventListener);
    this.removeEventListener('title-changed', this.onTitleChanged as EventListener);
    this.removeEventListener(
      'sheet-notes-changed',
      this.onSheetNotesChanged as EventListener,
    );
    this.removeEventListener('request-new-file', this.onRequestNewFile);
    this.removeEventListener('export-json', this.onExportJson);
    this.removeEventListener('print', this.onPrint);
    this.removeEventListener('row-text-change', this.onRowTextChange as EventListener);
    this.removeEventListener(
      'row-visibility-change',
      this.onRowVisibilityChange as EventListener,
    );
    this.removeEventListener(
      'section-visibility-change',
      this.onSectionVisibilityChange as EventListener,
    );
    this.removeEventListener('toggle-all-rows', this.onToggleAllRows as EventListener);
    window.removeEventListener('popstate', this.onPopState);
  }

  override render() {
    if (!this.parser || !this.session) {
      return html`
        <div class="shell">
          <main class="shell-main">
            <x32-upload .recentFiles=${this.recentFilesList}></x32-upload>
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
            .sheetNotes=${this.session.sheetNotes}
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
    const cachedMatches = findCachedScenesByFilename(filename);
    const exactMatch = cachedMatches.find((match) => match.scene.text === text);

    if (exactMatch) {
      this.openStoredSession(exactMatch.sessionId);
      return;
    }

    const latestSameName = cachedMatches[0];
    if (latestSameName && !this.shouldOpenSelectedScene(filename)) {
      this.openStoredSession(latestSameName.sessionId);
      return;
    }

    const id = sessionIdFor(filename, text);
    this.openSession({ sessionId: id, filename, size, text });
  };

  private onRecentSelected = (e: CustomEvent<RecentSelectedDetail>) => {
    this.openStoredSession(e.detail.sessionId);
  };

  private onTitleChanged = (e: CustomEvent<string>) => {
    this.mutateSession((s) => {
      s.title = e.detail;
    });
  };

  private onSheetNotesChanged = (e: CustomEvent<string>) => {
    this.mutateSession((s) => {
      s.sheetNotes = e.detail;
    });
  };

  private onRequestNewFile = () => {
    this.resetActiveSession();
  };

  private onExportJson = () => {
    if (!this.parser || !this.session) return;
    const payload = {
      filename: this.session.filename,
      title: this.session.title,
      sheetNotes: this.session.sheetNotes,
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

  private onPopState = () => {
    const sessionId = this.urlSessionId();
    if (!sessionId) {
      this.resetActiveSession(false);
      return;
    }
    if (!this.openStoredSession(sessionId, false)) {
      this.resetActiveSession(false);
    }
  };

  // ---------------- Session loading ----------------

  private restoreInitialSession(): void {
    const hintedSessionId = this.urlSessionId();
    if (hintedSessionId && this.openStoredSession(hintedSessionId, false)) {
      return;
    }
  }

  private openStoredSession(sessionId: string, syncUrl = true): boolean {
    const scene = loadScene(sessionId);
    if (!scene) return false;
    try {
      this.openSession({ sessionId, ...scene }, syncUrl);
      return true;
    } catch (err) {
      console.warn('Could not reopen cached scene:', err);
      return false;
    }
  }

  private openSession(
    scene: { sessionId: string; filename: string; size: number; text: string },
    syncUrl = true,
  ): void {
    const parser = new ScnParser();
    parser.parseText(scene.text);
    this.parser = parser;
    this.sessionId = scene.sessionId;
    this.session = loadSession(scene.sessionId) ?? makeEmptyState(scene.filename);
    this.persist({ filename: scene.filename, size: scene.size, text: scene.text });
    if (syncUrl) {
      this.syncUrl(scene.sessionId);
    }
  }

  // ---------------- State helpers ----------------

  private resetActiveSession(syncUrl = true): void {
    this.parser = null;
    this.session = null;
    this.sessionId = null;
    this.recentFilesList = recentFiles();
    if (syncUrl) {
      this.syncUrl(null);
    }
  }

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

  private persist(scene?: { filename: string; size: number; text: string }): void {
    if (this.sessionId && this.session) {
      saveSession(this.sessionId, this.session, scene);
      this.recentFilesList = recentFiles();
    }
  }

  private urlSessionId(): string | null {
    return readSessionIdFromHref(window.location.href);
  }

  private syncUrl(sessionId: string | null): void {
    const next = nextHrefForSession(window.location.href, sessionId);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(null, '', next);
    }
  }

  private shouldOpenSelectedScene(filename: string): boolean {
    return window.confirm(
      [
        `A different cached scene named "${filename}" already exists.`,
        'Press OK to open the newly selected file from disk.',
        'Press Cancel to keep using the cached copy instead.',
      ].join('\n\n'),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-app': AppShell;
  }
}

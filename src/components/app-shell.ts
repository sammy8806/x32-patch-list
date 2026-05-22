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
import './routing-visualizer.js';
import type {
  RecentRemoveRequestedDetail,
  RecentSelectedDetail,
  SceneSelectedDetail,
} from './upload-view.js';

import { ScnParser } from '../parser/scn-parser.js';
import {
  findCachedScenesByFilename,
  listCommentMigrationSources,
  loadScene,
  loadSession,
  makeEmptyState,
  mergeRowTextComments,
  recentFiles,
  removeSession,
  saveSession,
  sessionIdFor,
  type CommentMigrationSource,
  type RecentFile,
  type SessionState,
} from '../storage.js';
import {
  nextHrefForViewMode,
  nextHrefForSession,
  readSessionIdFromHref,
  readViewModeFromHref,
  type AppViewMode,
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
  @state() private commentMigrationSources: CommentMigrationSource[] = [];
  @state() private migrationNotice: string | null = null;
  @state() private viewMode: AppViewMode = 'list';

  override connectedCallback(): void {
    super.connectedCallback();
    this.recentFilesList = recentFiles();

    this.addEventListener('scene-selected', this.onSceneSelected as EventListener);
    this.addEventListener('recent-selected', this.onRecentSelected as EventListener);
    this.addEventListener(
      'recent-remove-requested',
      this.onRecentRemoveRequested as EventListener,
    );
    this.addEventListener('title-changed', this.onTitleChanged as EventListener);
    this.addEventListener('view-changed', this.onViewChanged as EventListener);
    this.addEventListener('sheet-notes-changed', this.onSheetNotesChanged as EventListener);
    this.addEventListener('request-new-file', this.onRequestNewFile);
    this.addEventListener(
      'request-comment-migration',
      this.onRequestCommentMigration,
    );
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
    this.addEventListener(
      'gap-collapse-change',
      this.onGapCollapseChange as EventListener,
    );
    window.addEventListener('popstate', this.onPopState);
    this.restoreInitialSession();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('scene-selected', this.onSceneSelected as EventListener);
    this.removeEventListener('recent-selected', this.onRecentSelected as EventListener);
    this.removeEventListener(
      'recent-remove-requested',
      this.onRecentRemoveRequested as EventListener,
    );
    this.removeEventListener('title-changed', this.onTitleChanged as EventListener);
    this.removeEventListener('view-changed', this.onViewChanged as EventListener);
    this.removeEventListener(
      'sheet-notes-changed',
      this.onSheetNotesChanged as EventListener,
    );
    this.removeEventListener('request-new-file', this.onRequestNewFile);
    this.removeEventListener(
      'request-comment-migration',
      this.onRequestCommentMigration,
    );
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
    this.removeEventListener(
      'gap-collapse-change',
      this.onGapCollapseChange as EventListener,
    );
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
            .viewMode=${this.viewMode}
          ></x32-toolbar>
          ${this.migrationNotice
            ? html`
                <div class="shell-notice">
                  <span>${this.migrationNotice}</span>
                  <button type="button" @click=${this.dismissMigrationNotice}>
                    Dismiss
                  </button>
                </div>
              `
            : nothing}
        </header>
        <main class="shell-main">
          ${this.renderActiveView()}
        </main>
        ${this.commentMigrationSources.length > 0
          ? this.renderCommentMigrationPicker()
          : nothing}
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

  private onRecentRemoveRequested = (
    e: CustomEvent<RecentRemoveRequestedDetail>,
  ) => {
    removeSession(e.detail.sessionId);
    this.recentFilesList = recentFiles();
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

  private onViewChanged = (e: CustomEvent<AppViewMode>) => {
    this.viewMode = e.detail;
    this.syncViewUrl(e.detail);
  };

  private onRequestNewFile = () => {
    this.resetActiveSession();
  };

  private onRequestCommentMigration = () => {
    if (!this.session) return;
    const sources = listCommentMigrationSources(
      this.sessionId,
      this.session.filename,
    );
    if (sources.length === 0) {
      this.migrationNotice =
        'No saved source or remarks comments were found in other files.';
      return;
    }
    this.commentMigrationSources = sources;
    this.migrationNotice = null;
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
    if (!this.session) return;

    const filename = this.session.filename;
    this.viewMode = 'list';
    this.syncViewUrl('list');
    requestAnimationFrame(() => this.printWithSceneFilename(filename));
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

  private onGapCollapseChange = (
    e: CustomEvent<{ key: string; collapsed: boolean }>,
  ) => {
    const { key, collapsed } = e.detail;
    this.mutateSession((s) => {
      s.collapsedGaps = { ...s.collapsedGaps, [key]: collapsed };
    });
  };

  private onPopState = () => {
    this.viewMode = readViewModeFromHref(window.location.href);
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
    this.viewMode = readViewModeFromHref(window.location.href);
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
    this.commentMigrationSources = [];
    this.migrationNotice = null;
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
    this.commentMigrationSources = [];
    this.migrationNotice = null;
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
      collapsedGaps: { ...this.session.collapsedGaps },
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

  private printWithSceneFilename(filename: string): void {
    const previousTitle = document.title;
    const sceneTitle = filename.replace(/\.[^./]+$/, '').trim();
    document.title = sceneTitle || previousTitle;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };

    window.addEventListener('afterprint', restoreTitle);
    window.print();
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

  private syncViewUrl(viewMode: AppViewMode): void {
    const next = nextHrefForViewMode(window.location.href, viewMode);
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

  private dismissMigrationNotice = () => {
    this.migrationNotice = null;
  };

  private closeCommentMigrationPicker = () => {
    this.commentMigrationSources = [];
  };

  private applyCommentMigration = (sourceSessionId: string) => {
    if (!this.session) return;

    const sourceSession = loadSession(sourceSessionId);
    if (!sourceSession) {
      this.commentMigrationSources = [];
      this.migrationNotice = 'That saved file could not be opened anymore.';
      return;
    }

    const merged = mergeRowTextComments(
      this.session.rowText,
      sourceSession.rowText,
    );
    this.commentMigrationSources = [];

    if (merged.importedFields === 0) {
      this.migrationNotice = [
        `No empty comment cells were available to fill from "${sourceSession.filename}".`,
        'Existing comments in the current file were left untouched.',
      ].join(' ');
      return;
    }

    this.mutateSession((s) => {
      s.rowText = merged.rowText;
    });
    this.migrationNotice = [
      `Imported ${formatCount(merged.importedFields, 'comment')} across`,
      `${formatCount(merged.importedRows, 'row')} from "${sourceSession.filename}".`,
      'Existing comments in the current file were kept.',
    ].join(' ');
  };

  private renderCommentMigrationPicker() {
    return html`
      <div
        class="shell-modal-backdrop"
        @click=${this.closeCommentMigrationPicker}
      >
        <section
          class="shell-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="comment-migration-title"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="shell-modal-header">
            <div>
              <h2 id="comment-migration-title">Migrate comments</h2>
              <p>
                Import saved <strong>Source</strong> and <strong>Remarks</strong>
                text from another file. Only empty cells in the current file will
                be filled.
              </p>
            </div>
            <button
              type="button"
              class="shell-modal-close"
              aria-label="Close"
              @click=${this.closeCommentMigrationPicker}
            >
              Close
            </button>
          </div>

          <div class="comment-migration-list">
            ${this.commentMigrationSources.map((source) => {
              const isSameFilename = source.filename === this.session?.filename;
              return html`
                <button
                  type="button"
                  class="comment-migration-item"
                  @click=${() => this.applyCommentMigration(source.sessionId)}
                >
                  <span class="comment-migration-name">${source.filename}</span>
                  <span class="comment-migration-meta">
                    ${formatCount(source.commentRowCount, 'commented row')}
                    · ${isSameFilename ? 'same filename' : 'other file'}
                    · ${this.formatUpdatedAt(source.updatedAt)}
                  </span>
                </button>
              `;
            })}
          </div>
        </section>
      </div>
    `;
  }

  private renderActiveView() {
    if (!this.parser || !this.session) return nothing;
    if (this.viewMode === 'patchbay' || this.viewMode === 'nodes') {
      return html`
        <x32-routing-visualizer
          .parser=${this.parser}
          .mode=${this.viewMode === 'nodes' ? 'nodes' : 'patchbay'}
          .filename=${this.session.filename}
          .visibleRows=${this.session.visibleRows}
          .visibleSections=${this.session.visibleSections}
        ></x32-routing-visualizer>
      `;
    }

    return html`
      <x32-patch-list
        .parser=${this.parser}
        .title=${this.session.title}
        .originalFileName=${this.session.filename}
        .sheetNotes=${this.session.sheetNotes}
        .rowText=${this.session.rowText}
        .visibleRows=${this.session.visibleRows}
        .visibleSections=${this.session.visibleSections}
        .collapsedGaps=${this.session.collapsedGaps}
      ></x32-patch-list>
    `;
  }

  private formatUpdatedAt(timestamp: number): string {
    if (!timestamp) return 'saved earlier';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp);
  }
}

function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'x32-app': AppShell;
  }
}

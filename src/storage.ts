/**
 * localStorage-backed persistence for reopenable scene sessions.
 *
 * Each session stores:
 *   - the original scene file contents (so recents can reopen directly)
 *   - patch-sheet metadata such as title and freeform notes
 *   - per-row remarks / source text (keyed by channel slot)
 *   - per-row visibility toggles and per-section visibility toggles
 *
 * Everything is scoped under a single top-level key so clearing it is a single
 * `delete`. State is saved against a "session id" — the hash of the loaded
 * scene filename + file size — so opening a different file doesn't clobber
 * the notes you wrote for the previous one.
 */

const ROOT_KEY = 'x32-patch-list/v1';

export interface SessionState {
  filename: string;
  title: string;
  sheetNotes: string;
  /** `remarks[rowKey] = { source, remarks }` */
  rowText: Record<string, { source?: string; remarks?: string }>;
  /** `visibleRows[rowKey] = boolean` — absent means "default visible". */
  visibleRows: Record<string, boolean>;
  /** `visibleSections[sectionKey] = boolean` — absent means "default visible". */
  visibleSections: Record<string, boolean>;
}

export interface CachedScene {
  filename: string;
  size: number;
  text: string;
}

interface StoredSession {
  state: SessionState;
  scene?: CachedScene;
  updatedAt: number;
}

interface StoredShape {
  lastSessionId?: string;
  lastFilename?: string;
  sessions: Record<string, StoredSession>;
}

function read(): StoredShape {
  try {
    const raw = localStorage.getItem(ROOT_KEY);
    if (!raw) return { sessions: {} };
    const parsed = JSON.parse(raw) as StoredShape;
    const sessions = Object.fromEntries(
      Object.entries(parsed.sessions ?? {}).map(([sessionId, entry]) => [
        sessionId,
        normalizeStoredSession(entry),
      ]),
    );
    return {
      lastSessionId: parsed.lastSessionId,
      lastFilename: parsed.lastFilename,
      sessions,
    };
  } catch {
    return { sessions: {} };
  }
}

function write(data: StoredShape): void {
  try {
    localStorage.setItem(ROOT_KEY, JSON.stringify(data));
  } catch {
    // Quota / private-mode failures are non-fatal.
  }
}

/**
 * Derive a stable-ish session id from filename + size. Good enough to keep
 * remarks paired with the right scene file without needing a hash library.
 */
export function sessionIdFor(filename: string, size: number): string {
  return `${filename}|${size}`;
}

export function loadSession(sessionId: string): SessionState | null {
  const root = read();
  return root.sessions[sessionId]?.state ?? null;
}

export function loadScene(sessionId: string): CachedScene | null {
  const root = read();
  return root.sessions[sessionId]?.scene ?? null;
}

export function saveSession(
  sessionId: string,
  state: SessionState,
  scene?: CachedScene,
): void {
  const root = read();
  const current = root.sessions[sessionId];
  root.sessions[sessionId] = {
    state: normalizeSessionState(state),
    scene: scene ?? current?.scene,
    updatedAt: Date.now(),
  };
  root.lastSessionId = sessionId;
  root.lastFilename = state.filename;
  write(root);
}

export function lastSessionId(): string | null {
  return read().lastSessionId ?? null;
}

export function lastFilename(): string | null {
  return read().lastFilename ?? null;
}

export interface RecentFile {
  sessionId: string;
  filename: string;
  cached: boolean;
  updatedAt: number;
}

/**
 * Derive a list of recent files from stored sessions. The most recently used
 * session is returned first. Entries advertise whether a cached scene payload
 * is available for direct reopen.
 */
export function recentFiles(limit = 5): RecentFile[] {
  const root = read();
  const lastId = root.lastSessionId;
  const entries = Object.entries(root.sessions);
  entries.sort(([a, aEntry], [b, bEntry]) => {
    if (a === lastId) return -1;
    if (b === lastId) return 1;
    return bEntry.updatedAt - aEntry.updatedAt;
  });
  return entries
    .slice(0, limit)
    .map(([sessionId, entry]) => ({
      sessionId,
      filename: entry.state.filename,
      cached: Boolean(entry.scene?.text),
      updatedAt: entry.updatedAt,
    }));
}

export function clearAll(): void {
  try {
    localStorage.removeItem(ROOT_KEY);
  } catch {
    // ignore
  }
}

export function makeEmptyState(filename: string): SessionState {
  return {
    filename,
    title: '',
    sheetNotes: '',
    rowText: {},
    visibleRows: {},
    visibleSections: {},
  };
}

function normalizeStoredSession(value: unknown): StoredSession {
  if (isStoredSession(value)) {
    return {
      state: normalizeSessionState(value.state),
      scene: normalizeScene(value.scene),
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    };
  }

  return {
    state: normalizeSessionState(value),
    updatedAt: 0,
  };
}

function normalizeSessionState(value: unknown): SessionState {
  const record = isRecord(value) ? value : {};
  const filename =
    typeof record.filename === 'string' && record.filename.trim()
      ? record.filename
      : 'Untitled.scn';

  return {
    filename,
    title: typeof record.title === 'string' ? record.title : '',
    sheetNotes:
      typeof record.sheetNotes === 'string' ? record.sheetNotes : '',
    rowText: isRecord(record.rowText) ? record.rowText : {},
    visibleRows: isRecord(record.visibleRows) ? record.visibleRows : {},
    visibleSections: isRecord(record.visibleSections)
      ? record.visibleSections
      : {},
  };
}

function normalizeScene(value: unknown): CachedScene | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.filename !== 'string' ||
    typeof value.size !== 'number' ||
    typeof value.text !== 'string'
  ) {
    return undefined;
  }
  return {
    filename: value.filename,
    size: value.size,
    text: value.text,
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  return isRecord(value) && 'state' in value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

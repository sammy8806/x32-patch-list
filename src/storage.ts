/**
 * localStorage-backed persistence for user-entered state.
 *
 * Four things are persisted:
 *   - the title shown in print output
 *   - the last filename (so we can prompt "re-select <filename>" on reload)
 *   - per-row remarks / source text (keyed by channel slot)
 *   - per-row visibility toggles and per-section visibility toggles
 *
 * Everything is scoped under a single top-level key so clearing it is a single
 * `delete`. State is saved against a "session id" — the hash of the loaded
 * scene filename + file size — so opening a different file doesn't clobber
 * the remarks you wrote for the previous one.
 */

const ROOT_KEY = 'x32-patch-list/v1';

export interface SessionState {
  filename: string;
  title: string;
  /** `remarks[rowKey] = { source, remarks }` */
  rowText: Record<string, { source?: string; remarks?: string }>;
  /** `visibleRows[rowKey] = boolean` — absent means "default visible". */
  visibleRows: Record<string, boolean>;
  /** `visibleSections[sectionKey] = boolean` — absent means "default visible". */
  visibleSections: Record<string, boolean>;
}

interface StoredShape {
  lastSessionId?: string;
  lastFilename?: string;
  sessions: Record<string, SessionState>;
}

function read(): StoredShape {
  try {
    const raw = localStorage.getItem(ROOT_KEY);
    if (!raw) return { sessions: {} };
    const parsed = JSON.parse(raw) as StoredShape;
    parsed.sessions ??= {};
    return parsed;
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
  return root.sessions[sessionId] ?? null;
}

export function saveSession(sessionId: string, state: SessionState): void {
  const root = read();
  root.sessions[sessionId] = state;
  root.lastSessionId = sessionId;
  root.lastFilename = state.filename;
  write(root);
}

export function lastFilename(): string | null {
  return read().lastFilename ?? null;
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
    rowText: {},
    visibleRows: {},
    visibleSections: {},
  };
}

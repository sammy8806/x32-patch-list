import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  clearAll,
  lastSessionId,
  loadScene,
  loadSession,
  makeEmptyState,
  recentFiles,
  saveSession,
  sessionIdFor,
} from '../src/storage.js';

const ROOT_KEY = 'x32-patch-list/v1';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

let originalLocalStorage: Storage | undefined;

beforeEach(() => {
  originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  clearAll();
  Object.defineProperty(globalThis, 'localStorage', {
    value: originalLocalStorage,
    configurable: true,
    writable: true,
  });
});

describe('storage', () => {
  test('persists cached scene content and patch-sheet state together', () => {
    const originalDateNow = Date.now;
    Date.now = () => 100;

    try {
      const sessionId = sessionIdFor('festival.scn', 42);
      const state = {
        ...makeEmptyState('festival.scn'),
        title: 'Festival A',
        sheetNotes: 'Stage left wedges on aux 1-4',
        rowText: {
          'output:out:0:0': { source: 'DL32 1', remarks: 'Lead vocal' },
        },
      };

      saveSession(sessionId, state, {
        filename: 'festival.scn',
        size: 42,
        text: '/config/chlink/1-2 OFF',
      });

      expect(loadSession(sessionId)).toEqual(state);
      expect(loadScene(sessionId)).toEqual({
        filename: 'festival.scn',
        size: 42,
        text: '/config/chlink/1-2 OFF',
      });
      expect(lastSessionId()).toBe(sessionId);
      expect(recentFiles()).toEqual([
        {
          sessionId,
          filename: 'festival.scn',
          cached: true,
          updatedAt: 100,
        },
      ]);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('migrates legacy uncached sessions without losing existing notes', () => {
    const sessionId = sessionIdFor('legacy.scn', 7);
    localStorage.setItem(
      ROOT_KEY,
      JSON.stringify({
        lastSessionId: sessionId,
        lastFilename: 'legacy.scn',
        sessions: {
          [sessionId]: {
            filename: 'legacy.scn',
            title: 'Legacy Title',
            rowText: {
              'input:in:0:0': { remarks: 'Keep' },
            },
            visibleRows: {
              'input:in:0:0': false,
            },
            visibleSections: {
              'input:in': true,
            },
          },
        },
      }),
    );

    expect(loadSession(sessionId)).toEqual({
      filename: 'legacy.scn',
      title: 'Legacy Title',
      sheetNotes: '',
      rowText: {
        'input:in:0:0': { remarks: 'Keep' },
      },
      visibleRows: {
        'input:in:0:0': false,
      },
      visibleSections: {
        'input:in': true,
      },
    });
    expect(loadScene(sessionId)).toBeNull();
    expect(recentFiles()).toEqual([
      {
        sessionId,
        filename: 'legacy.scn',
        cached: false,
        updatedAt: 0,
      },
    ]);
  });
});

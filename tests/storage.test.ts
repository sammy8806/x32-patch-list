import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  clearAll,
  findCachedScenesByFilename,
  lastSessionId,
  listCommentMigrationSources,
  loadScene,
  loadSession,
  makeEmptyState,
  mergeRowTextComments,
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
    const sceneText = '/config/chlink/1-2 OFF';

    try {
      const sessionId = sessionIdFor('festival.scn', sceneText);
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
        text: sceneText,
      });

      expect(loadSession(sessionId)).toEqual(state);
      expect(loadScene(sessionId)).toEqual({
        filename: 'festival.scn',
        size: 42,
        text: sceneText,
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

  test('gives changed same-name scenes distinct ids and finds cached matches', () => {
    const firstText = '/ch/01/config "Kick"';
    const secondText = '/ch/01/config "Snare"';
    const firstId = sessionIdFor('festival.scn', firstText);
    const secondId = sessionIdFor('festival.scn', secondText);

    expect(firstId).not.toBe(secondId);

    const originalDateNow = Date.now;
    try {
      Date.now = () => 100;
      saveSession(firstId, makeEmptyState('festival.scn'), {
        filename: 'festival.scn',
        size: 10,
        text: firstText,
      });

      Date.now = () => 200;
      saveSession(secondId, makeEmptyState('festival.scn'), {
        filename: 'festival.scn',
        // Keep the same file size to prove notes are scoped by content,
        // not by the older filename+size heuristic.
        size: 10,
        text: secondText,
      });

      expect(findCachedScenesByFilename('festival.scn').map((match) => match.sessionId)).toEqual([
        secondId,
        firstId,
      ]);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('migrates legacy uncached sessions without losing existing notes', () => {
    const sessionId = 'legacy.scn|7';
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
      collapsedGaps: {},
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

  test('lists saved comment sources with likely successors first', () => {
    const originalDateNow = Date.now;

    try {
      const currentId = sessionIdFor('tour-2026-04-23.scn', '/current');
      const sameShowId = sessionIdFor('tour-2026-04-16.scn', '/same-show');
      const exactNameId = sessionIdFor('tour-2026-04-23.scn', '/exact-name-old');
      const otherId = sessionIdFor('festival.scn', '/other');

      Date.now = () => 100;
      saveSession(sameShowId, {
        ...makeEmptyState('tour-2026-04-16.scn'),
        rowText: {
          'input:in:0:0': { remarks: 'Lead vocal RF' },
        },
      });

      Date.now = () => 200;
      saveSession(otherId, {
        ...makeEmptyState('festival.scn'),
        rowText: {
          'output:out:0:0': { source: 'Stage rack 1' },
        },
      });

      Date.now = () => 300;
      saveSession(exactNameId, {
        ...makeEmptyState('tour-2026-04-23.scn'),
        rowText: {
          'input:in:1:0': { remarks: 'Spare handheld' },
        },
      });

      Date.now = () => 400;
      saveSession(currentId, {
        ...makeEmptyState('tour-2026-04-23.scn'),
        rowText: {
          'input:in:2:0': { remarks: '' },
        },
      });

      expect(
        listCommentMigrationSources(currentId, 'tour-2026-04-23.scn'),
      ).toEqual([
        {
          sessionId: exactNameId,
          filename: 'tour-2026-04-23.scn',
          updatedAt: 300,
          commentRowCount: 1,
        },
        {
          sessionId: sameShowId,
          filename: 'tour-2026-04-16.scn',
          updatedAt: 100,
          commentRowCount: 1,
        },
        {
          sessionId: otherId,
          filename: 'festival.scn',
          updatedAt: 200,
          commentRowCount: 1,
        },
      ]);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('merges comments without overwriting existing current text', () => {
    expect(
      mergeRowTextComments(
        {
          'input:in:0:0': { source: 'Current source' },
          'input:in:1:0': { remarks: '   ' },
          'input:in:2:0': { remarks: 'Keep me' },
        },
        {
          'input:in:0:0': { source: 'Old source', remarks: 'Copy remarks' },
          'input:in:1:0': { remarks: 'Copied into blank field' },
          'input:in:2:0': { source: 'Added source', remarks: 'Ignored remarks' },
          'output:out:0:0': { source: 'Stagebox 1' },
          'output:out:1:0': { source: '   ' },
        },
      ),
    ).toEqual({
      rowText: {
        'input:in:0:0': {
          source: 'Current source',
          remarks: 'Copy remarks',
        },
        'input:in:1:0': { remarks: 'Copied into blank field' },
        'input:in:2:0': {
          source: 'Added source',
          remarks: 'Keep me',
        },
        'output:out:0:0': { source: 'Stagebox 1' },
      },
      importedRows: 4,
      importedFields: 4,
    });
  });
});

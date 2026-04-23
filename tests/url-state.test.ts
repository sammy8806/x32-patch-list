import { describe, expect, test } from 'bun:test';

import {
  nextHrefForSession,
  readSessionIdFromHref,
} from '../src/url-state.js';

describe('url-state', () => {
  test('reads the file hint from the current URL', () => {
    expect(
      readSessionIdFromHref(
        'https://example.test/patch-list?file=festival.scn%7C42',
      ),
    ).toBe('festival.scn|42');
  });

  test('adds the file hint without dropping other query params or hash', () => {
    expect(
      nextHrefForSession(
        'https://example.test/patch-list?view=print#sheet',
        'festival.scn|42',
      ),
    ).toBe('/patch-list?view=print&file=festival.scn%7C42#sheet');
  });

  test('removes the file hint cleanly', () => {
    expect(
      nextHrefForSession(
        'https://example.test/patch-list?view=print&file=festival.scn%7C42#sheet',
        null,
      ),
    ).toBe('/patch-list?view=print#sheet');
  });
});

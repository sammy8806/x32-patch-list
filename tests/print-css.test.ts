import { describe, expect, test } from 'bun:test';

describe('print.css', () => {
  test('does not restore ignored collapsed rows for printing', async () => {
    const css = await Bun.file('src/styles/print.css').text();

    expect(css).toContain('table.patch tr.gap-collapsed:not(.ignore)');
    expect(css).not.toContain('table.patch tr.gap-collapsed {');
  });
});

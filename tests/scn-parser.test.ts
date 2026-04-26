/**
 * Port of `legacy/tests/test_x32parser.py`. Each case here mirrors an
 * assertion in the original Python suite so we can verify behaviour parity.
 */

import { describe, expect, test } from 'bun:test';

import { ScnParser } from '../src/parser/scn-parser.js';

function parseScene(sceneText: string): ScnParser {
  // Strip common leading indentation so tests can use template-literal blocks.
  const dedented = dedent(sceneText).trim();
  const parser = new ScnParser();
  parser.parseText(`${dedented}\n`);
  return parser;
}

/** Minimal `textwrap.dedent` equivalent. */
function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(min)).join('\n');
}

describe('ScnParser routing', () => {
  test('user routing maps AES50-B correctly', () => {
    const parser = parseScene(`
      /config/userrout/in/01 81
    `);

    expect(parser.userRouteByName['user-in.01']).toBe('aes50b.01');
  });

  test('duplicate user input routes keep all AES50 assignments', () => {
    const parser = parseScene(`
      /config/userrout/in/01 33 33
      /config/routing/IN/1-8 UIN1-8
      /ch/01/config VocalA 0 RD 1
      /ch/02/config VocalB 0 BL 2
    `);

    const routedChannels = parser.getChannelListForType('aes50a')[0];
    expect(routedChannels).not.toBeNull();
    expect(routedChannels!.map((channel) => channel.name)).toEqual([
      'VocalA',
      'VocalB',
    ]);
  });

  test('PLAY routing becomes active when route switch is PLAY', () => {
    const parser = parseScene(`
      /config/routing/routswitch 1
      /config/routing/IN/1-8 AN1-8
      /config/routing/PLAY/1-8 A1-8
      /ch/01/config PlaybackVox 0 RD 1
    `);

    const aes = parser.getChannelListForType('aes50a')[0];
    expect(aes).not.toBeNull();
    expect(aes!.map((ch) => ch.name)).toEqual(['PlaybackVox']);

    expect(parser.getChannelListForType('in')[0]).toBeNull();
  });

  test('user route position tracks slot, not last duplicate source', () => {
    const parser = parseScene(`
      /config/userrout/out/01 169 169
      /config/routing/AES50A/1-8 UOUT1-8
    `);

    expect(parser.getOutputUserRoutePosition('aes50a.01')).toBe('user-out.01');
    expect(parser.getOutputUserRoutePosition('aes50a.02')).toBe('user-out.02');
  });

  test('input user-route lookup ignores user-out mappings for shared source keys', () => {
    const parser = parseScene(`
      /config/userrout/in/01 129
      /config/userrout/out/01 153
    `);

    expect(parser.getInputUserRoutePosition('card.01')).toBe('user-in.01');
    expect(parser.getInputUserRoutePosition('card.25')).toBeNull();
  });

  test('output local sources resolve through active input routing', () => {
    const userOut = ['1', ...Array(46).fill('0'), '3'].join(' ');
    const parser = parseScene(`
      /config/userrout/out/01 ${userOut}
      /config/routing/CARD/1-8 OFF OFF OFF UOUT41-48
      /config/routing/IN/1-8 AN1-8
      /ch/32/config MessIN 0 RD 3
    `);

    const row = parser.getOutputListForType('card')[31];
    if (!row || 'p16' in row) throw new Error('expected channel');

    expect(row.name).toBe('MessIN');
    expect(row.channel_index).toBe(32);
    expect(row.output_source_label).toBe('Local 03');
  });

  test('output local sources use source labels when no channel is assigned', () => {
    const parser = parseScene(`
      /config/userrout/out/01 1
      /config/routing/CARD/1-8 UOUT1-8
    `);

    const row = parser.getOutputListForType('card')[0];
    if (!row || 'p16' in row) throw new Error('expected source fallback');

    expect(row.name).toBe('Local 01');
    expect(row.color).toBe('OFF');
    expect(row.output_source_label).toBe('Local 01');
  });
});

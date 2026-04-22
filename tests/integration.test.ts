/**
 * End-to-end smoke test: parse a representative scene file and spot-check the
 * query API. Not a byte-for-byte comparison to the Python output; that would
 * be fragile. Instead we assert the shapes and values we depend on in the UI.
 */

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ScnParser } from '../src/parser/scn-parser.js';
import { getDeskName } from '../src/parser/display.js';

describe('end-to-end fixture', () => {
  test('parses a representative scene without errors', async () => {
    const text = await readFile(
      join(import.meta.dir, 'fixtures', 'sample.scn'),
      'utf8',
    );
    const parser = new ScnParser();
    parser.parseText(text);

    // Channels parsed out of /ch/NN/config lines.
    expect(parser.channels['in.01']?.name).toBe('Kick In');
    expect(parser.channels['in.17']?.name).toBe('Lead Vox');

    // Mix-style channels.
    expect(parser.channels['main.l']?.name).toBe('FOH L/R');
    expect(parser.channels['main.r']?.name).toBe('FOH L/R');
    expect(parser.channels['main.m']?.name).toBe('FOH Mono');
    expect(parser.channels['bus.01']?.name).toBe('Monitors');
    expect(parser.channels['mtx.01']?.name).toBe('Recording L');
    expect(parser.channels['fx.01']?.name).toBe('Reverb Return');

    // Synthesized internal channels.
    expect(parser.channels['mon.l']?.name).toBe('Monitor L');
    expect(parser.channels['tb']?.name).toBe('Talkback');

    // Local input slots feed the configured channels.
    const inList = parser.getChannelListForType('in');
    expect(inList[0]?.map((c) => c.name)).toEqual(['Kick In']);
    expect(inList[1]?.map((c) => c.name)).toEqual(['Kick Out']);

    // A physical AES50-A slot gets its name via the IN/1-8 AN1-8 block —
    // there is no configured AES50-A routing here, so it should be empty.
    const aesList = parser.getChannelListForType('aes50a');
    expect(aesList[8]).toBeNull();

    // Main outputs are wired to bus.01 (source 4 → bus.01).
    const outRow0 = parser.getOutputListForType('out')[0];
    if (!outRow0 || 'p16' in outRow0) throw new Error('expected channel');
    expect(outRow0.name).toBe('Monitors');

    // Aux output 1 is configured to main.l via `/outputs/aux/01 1 0 0`.
    const auxRow0 = parser.getOutputListForType('aux')[0];
    if (!auxRow0 || 'p16' in auxRow0) throw new Error('expected channel');
    expect(auxRow0.name).toBe('FOH L/R');

    // Desk-name formatting covers mix vs channel families.
    expect(getDeskName(parser.channels['main.l'])).toBe('Main L');
    expect(getDeskName(parser.channels['bus.01'])).toBe('Bus 01');
    expect(getDeskName(parser.channels['auxin.01'])).toBe('Aux 1');
  });
});

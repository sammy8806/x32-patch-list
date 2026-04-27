import { describe, expect, test } from 'bun:test';

import { ScnParser } from '../src/parser/scn-parser.js';
import { buildRoutingVisualModel } from '../src/routing-visual-model.js';

function parseScene(sceneText: string): ScnParser {
  const text = sceneText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  const parser = new ScnParser();
  parser.parseText(`${text}\n`);
  return parser;
}

describe('routing visual model', () => {
  test('builds user-in and user-out hops from parsed routing', () => {
    const parser = parseScene(`
      /config/userrout/in/01 33 34
      /config/userrout/out/01 169 170
      /config/routing/IN/1-8 UIN1-8
      /config/routing/OUT/1-4 UOUT1-4
      /ch/01/config Vox 0 RD 1
      /ch/02/config Guitar 0 GN 2
      /bus/01/config Monitor 0 YE
      /outputs/main/01 4 0 0
      /outputs/main/02 4 0 0
    `);

    const model = buildRoutingVisualModel(parser);
    const connectionKeys = model.connections.map(
      (connection) => `${connection.fromPin}->${connection.toPin}`,
    );

    expect(model.stats.activeUserInputs).toBe(2);
    expect(model.stats.activeUserOutputs).toBe(2);
    expect(model.sources.map((source) => source.key)).toContain('aes50a.01');
    expect(model.processors.map((processor) => processor.key)).toContain('in.01');
    expect(model.processors.map((processor) => processor.key)).toContain('bus.01');
    expect(model.outputs.map((output) => output.key)).toContain('out.01');
    expect(connectionKeys).toContain('src:aes50a.01:out->user:user-in.01:in');
    expect(connectionKeys).toContain('user:user-in.01:out->proc:in.01:in');
    expect(connectionKeys).toContain('proc:bus.01:out->user:user-out.01:in');
    expect(connectionKeys).toContain('user:user-out.01:out->out:out.01:in');
  });

  test('respects patch-list row and section visibility by default', () => {
    const parser = parseScene(`
      /config/userrout/in/01 33
      /config/userrout/out/01 169
      /config/routing/IN/1-8 UIN1-8
      /config/routing/OUT/1-4 UOUT1-4
      /ch/01/config Vox 0 RD 1
      /bus/01/config Monitor 0 YE
    `);

    const hidden = buildRoutingVisualModel(parser, {
      visibleRows: {
        'input:aes50a:0:0': false,
      },
      visibleSections: {
        'output:out': false,
      },
    });

    expect(hidden.sources.map((source) => source.key)).not.toContain('aes50a.01');
    expect(hidden.processors.map((processor) => processor.key)).not.toContain(
      'in.01',
    );
    expect(hidden.outputs).toHaveLength(0);
    expect(hidden.stats.activeUserInputs).toBe(0);
    expect(hidden.userInputs).toHaveLength(0);
    expect(hidden.userOutputs).toHaveLength(0);

    const full = buildRoutingVisualModel(parser, {
      visibleRows: {
        'input:aes50a:0:0': false,
      },
      visibleSections: {
        'output:out': false,
      },
      includeHidden: true,
    });

    expect(full.sources.map((source) => source.key)).toContain('aes50a.01');
    expect(full.processors.map((processor) => processor.key)).toContain('in.01');
    expect(full.outputs.map((output) => output.key)).toContain('out.01');
    expect(full.stats.activeUserInputs).toBe(1);
    expect(full.userInputs.length).toBeGreaterThan(1);
  });
});

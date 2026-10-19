import { type BufferAttribute, Color } from 'three';
import type { ShellRange } from '../lib/twinBuildings';
import { mapColors, twinColors } from '../styles/tokens';
import { createShellColours, paintShell, SHELL_HOVER_COLOUR } from './shellLooks';

/* Three runs in Node without WebGL: these are buffers, as for the box layers. */

const range = (zoneId: string, firstVertex: number, vertexCount: number): ShellRange => ({
  zoneId,
  firstVertex,
  vertexCount,
  firstTriangle: 0,
  triangleCount: 0,
  firstSegment: 0,
  segmentCount: 0,
});

/** Two buildings of 10 and 15 vertices, then one more of 5, in one buffer of 30. */
const RANGES = [range('A', 0, 10), range('B', 10, 15), range('C', 25, 5)];

const hexOf = (color: string): string => `#${new Color(color).getHexString()}`;
const colourAt = (attribute: BufferAttribute, v: number): string =>
  `#${new Color().fromBufferAttribute(attribute, v).getHexString()}`;
const colours = (attribute: BufferAttribute, first: number, count: number): Set<string> =>
  new Set(Array.from({ length: count }, (_, i) => colourAt(attribute, first + i)));

describe('createShellColours', () => {
  it('is the idle top on every vertex, as the shells were drawn before they had a colour each', () => {
    const attribute = createShellColours(30);

    expect(attribute.count).toBe(30);
    expect(colours(attribute, 0, 30)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });
});

describe('paintShell', () => {
  it('tints exactly the vertices of the hovered building', () => {
    const attribute = createShellColours(30);

    paintShell(attribute, RANGES, 'B', null);

    expect(colours(attribute, 10, 15)).toEqual(new Set([hexOf(SHELL_HOVER_COLOUR)]));
    expect(colours(attribute, 0, 10)).toEqual(new Set([hexOf(twinColors.idle.top)]));
    expect(colours(attribute, 25, 5)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });

  it('asks for the attribute to be uploaded', () => {
    const attribute = createShellColours(30);
    const version = attribute.version;

    paintShell(attribute, RANGES, 'A', null);

    expect(attribute.version).toBeGreaterThan(version);
  });

  it('moves the tint from one building to the next', () => {
    const attribute = createShellColours(30);
    paintShell(attribute, RANGES, 'A', null);

    paintShell(attribute, RANGES, 'C', 'A');

    expect(colours(attribute, 0, 10)).toEqual(new Set([hexOf(twinColors.idle.top)]));
    expect(colours(attribute, 25, 5)).toEqual(new Set([hexOf(SHELL_HOVER_COLOUR)]));
  });

  it('restores the building it leaves when nothing is hovered', () => {
    const attribute = createShellColours(30);
    paintShell(attribute, RANGES, 'B', null);

    paintShell(attribute, RANGES, null, 'B');

    expect(colours(attribute, 0, 30)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });

  it('changes nothing for a zone that has no building', () => {
    const attribute = createShellColours(30);

    paintShell(attribute, RANGES, 'GONE', null);

    expect(colours(attribute, 0, 30)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });

  it('writes nothing when there is nothing to leave and nothing to enter', () => {
    const attribute = createShellColours(30);
    const version = attribute.version;

    paintShell(attribute, RANGES, null, null);

    expect(attribute.version).toBe(version);
  });
});

describe('SHELL_HOVER_COLOUR', () => {
  it('is the hover top of the tokens: 30 % of the accent into the idle top', () => {
    expect(SHELL_HOVER_COLOUR).toBe(twinColors.hover.top);
    expect(mapColors.accent).not.toBe(SHELL_HOVER_COLOUR);
  });
});

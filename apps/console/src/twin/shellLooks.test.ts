import { type BufferAttribute, Color } from 'three';
import type { ShellRange } from '../lib/twin-core/twinBuildings';
import { mapColors, twinColors } from '../styles/tokens';
import { createShellColours, paintHeat, paintShell, SHELL_HOVER_COLOUR } from './shellLooks';

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

describe('paintShell over the heat overlay (V2-17.3)', () => {
  const HEAT = new Map([
    ['A', '#3d4f99'],
    ['B', '#7b8af0'],
  ]);

  it('gives the building it leaves its ramp colour, not idle', () => {
    const attribute = createShellColours(30);
    paintHeat(attribute, RANGES, HEAT);
    paintShell(attribute, RANGES, 'A', null, HEAT);

    paintShell(attribute, RANGES, 'B', 'A', HEAT);

    expect(colours(attribute, 0, 10)).toEqual(new Set([hexOf('#3d4f99')]));
    expect(colours(attribute, 10, 15)).toEqual(new Set([hexOf(SHELL_HOVER_COLOUR)]));
  });

  it('gives a building with no ramp colour back idle: a silent one', () => {
    const attribute = createShellColours(30);
    paintHeat(attribute, RANGES, HEAT);
    paintShell(attribute, RANGES, 'C', null, HEAT);

    paintShell(attribute, RANGES, null, 'C', HEAT);

    expect(colours(attribute, 25, 5)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });

  it('restores the building to its ramp colour when nothing is hovered any more', () => {
    const attribute = createShellColours(30);
    paintHeat(attribute, RANGES, HEAT);
    paintShell(attribute, RANGES, 'B', null, HEAT);

    paintShell(attribute, RANGES, null, 'B', HEAT);

    expect(colours(attribute, 10, 15)).toEqual(new Set([hexOf('#7b8af0')]));
  });
});

describe('paintHeat', () => {
  const HEAT = new Map([
    ['A', '#1f2a4d'],
    ['B', '#b3bdff'],
  ]);

  it('paints each building its own ramp colour, exactly on its vertices', () => {
    const attribute = createShellColours(30);

    paintHeat(attribute, RANGES, HEAT);

    expect(colours(attribute, 0, 10)).toEqual(new Set([hexOf('#1f2a4d')]));
    expect(colours(attribute, 10, 15)).toEqual(new Set([hexOf('#b3bdff')]));
  });

  it('leaves a building with no ramp colour idle: silent buildings are faded, not coloured', () => {
    const attribute = createShellColours(30);

    paintHeat(attribute, RANGES, HEAT);

    expect(colours(attribute, 25, 5)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });

  it('puts every building back to idle without an overlay: how the layer is switched off', () => {
    const attribute = createShellColours(30);
    paintHeat(attribute, RANGES, HEAT);

    paintHeat(attribute, RANGES, null);

    expect(colours(attribute, 0, 30)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });

  it('keeps the hover tint on the hovered building over its colour', () => {
    const attribute = createShellColours(30);

    paintHeat(attribute, RANGES, HEAT, 'B');

    expect(colours(attribute, 10, 15)).toEqual(new Set([hexOf(SHELL_HOVER_COLOUR)]));
    expect(colours(attribute, 0, 10)).toEqual(new Set([hexOf('#1f2a4d')]));
  });

  it('writes the colour in the working space as the other colours of the attribute are', () => {
    const attribute = createShellColours(30);

    paintHeat(attribute, RANGES, HEAT);

    const written = new Color().fromBufferAttribute(attribute, 0);
    expect(written.getHex()).toBe(new Color('#1f2a4d').getHex());
    expect(written.r).toBeCloseTo(new Color('#1f2a4d').r, 6);
  });

  it('asks for the attribute to be uploaded, once for the whole paint', () => {
    const attribute = createShellColours(30);
    const version = attribute.version;

    paintHeat(attribute, RANGES, HEAT);

    expect(attribute.version).toBeGreaterThan(version);
  });

  it('touches nothing outside the ranges and survives a zone that has no building', () => {
    const attribute = createShellColours(30);

    paintHeat(attribute, RANGES, new Map([['GONE', '#ffffff']]), 'GONE');

    expect(colours(attribute, 0, 30)).toEqual(new Set([hexOf(twinColors.idle.top)]));
  });

  it('is a no-op on an empty shell', () => {
    const attribute = createShellColours(0);
    const version = attribute.version;

    paintHeat(attribute, [], HEAT);

    expect(attribute.version).toBe(version);
  });
});

describe('SHELL_HOVER_COLOUR', () => {
  it('is the hover top of the tokens: 30 % of the accent into the idle top', () => {
    expect(SHELL_HOVER_COLOUR).toBe(twinColors.hover.top);
    expect(mapColors.accent).not.toBe(SHELL_HOVER_COLOUR);
  });
});

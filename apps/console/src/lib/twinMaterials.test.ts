import { INCIDENT_SEVERITIES, type IncidentSeverity } from '@occ/contracts';
import { mapColors, twinColors } from '../styles/tokens';
import {
  type AssetLook,
  edgeColour,
  faceColour,
  GHOST_OPACITY,
  HOVER_MIX,
  type LookFlags,
  lookOf,
  MATERIAL_NAMES,
  materialSpec,
  mixInto,
  tintFor,
} from './twinMaterials';

describe('materialSpec', () => {
  it('knows the contract’s eight names', () => {
    expect([...MATERIAL_NAMES]).toEqual([
      'Part',
      'Steel',
      'Concrete',
      'Rail',
      'Screen',
      'Blade',
      'Hub',
      'Xray',
    ]);
  });

  it.each([
    ['Part', twinColors.idle.top],
    ['Steel', twinColors.steel.top],
    ['Concrete', twinColors.concrete.top],
    ['Rail', twinColors.rail],
    ['Screen', twinColors.screen],
    ['Blade', twinColors.blade],
    ['Hub', twinColors.hub],
  ])('paints %s with its token', (name, color) => {
    expect(materialSpec(name)).toEqual({ name, color, opacity: 1 });
  });

  it('draws Xray as the idle material, see-through', () => {
    expect(materialSpec('Xray')).toEqual({
      name: 'Xray',
      color: twinColors.idle.top,
      opacity: twinColors.xrayOpacity,
    });
  });

  it('makes Xray the only material that is not solid', () => {
    expect(MATERIAL_NAMES.filter((name) => materialSpec(name).opacity < 1)).toEqual(['Xray']);
  });

  it.each([['Chrome'], ['part'], ['']])('falls back to Part for %j', (name) => {
    expect(materialSpec(name)).toEqual(materialSpec('Part'));
    expect(materialSpec(name).name).toBe('Part');
  });

  it('falls back to Part for a material with no name', () => {
    expect(materialSpec(undefined).name).toBe('Part');
  });
});

// --- looks (V2-14.9) -----------------------------------------------------------------------------------------

describe('mixInto', () => {
  it('is the base at weight 0 and the other colour at weight 1', () => {
    expect(mixInto('#2a4658', '#ff5a4e', 0)).toBe('#2a4658');
    expect(mixInto('#2a4658', '#ff5a4e', 1)).toBe('#ff5a4e');
  });

  it('mixes channel by channel and rounds, as the tokens’ color-mix does', () => {
    expect(mixInto('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixInto('#102030', '#102030', 0.35)).toBe('#102030');
  });

  it('reproduces the alarm tokens: critical at the alarm mix into each idle face', () => {
    const critical = mapColors.severity.critical;
    expect(mixInto(twinColors.idle.top, critical, twinColors.alarmMix)).toBe(twinColors.alarm.top);
    expect(mixInto(twinColors.idle.south, critical, twinColors.alarmMix)).toBe(
      twinColors.alarm.south,
    );
    expect(mixInto(twinColors.idle.east, critical, twinColors.alarmMix)).toBe(
      twinColors.alarm.east,
    );
  });

  it('reproduces the hover tokens: the accent at 30 % into each idle face', () => {
    expect(HOVER_MIX).toBe(0.3);
    for (const face of ['top', 'south', 'east'] as const) {
      expect(mixInto(twinColors.idle[face], mapColors.accent, HOVER_MIX)).toBe(
        twinColors.hover[face],
      );
    }
  });
});

describe('tintFor', () => {
  it('is --tw-alarm-top for critical on the idle material', () => {
    expect(tintFor('critical', twinColors.idle.top)).toBe(twinColors.alarm.top);
  });

  it('mixes every severity at the same weight into any base, and differently for each severity', () => {
    const tints = INCIDENT_SEVERITIES.map((severity) => tintFor(severity, twinColors.neutral));
    expect(new Set(tints).size).toBe(INCIDENT_SEVERITIES.length);
    for (const severity of INCIDENT_SEVERITIES) {
      expect(tintFor(severity, twinColors.neutral)).toBe(
        mixInto(twinColors.neutral, mapColors.severity[severity], twinColors.alarmMix),
      );
    }
  });
});

const LIVE: LookFlags = { stale: false, online: true, alarm: null };

describe('lookOf', () => {
  type Row = [
    name: string,
    flags: LookFlags,
    hovered: boolean,
    selected: boolean,
    expected: Pick<AssetLook, 'face' | 'edge' | 'motion'>,
  ];

  const rows: Row[] = [
    ['live and quiet', LIVE, false, false, { face: 'idle', edge: 'idle', motion: true }],
    [
      'stale',
      { ...LIVE, stale: true },
      false,
      false,
      { face: 'stale', edge: 'stale-dashed', motion: false },
    ],
    [
      'offline',
      { ...LIVE, online: false },
      false,
      false,
      { face: 'stale', edge: 'stale-dashed', motion: false },
    ],
    [
      'stale and offline',
      { stale: true, online: false, alarm: null },
      false,
      false,
      { face: 'stale', edge: 'stale-dashed', motion: false },
    ],
    [
      'alarmed',
      { ...LIVE, alarm: 'high' },
      false,
      false,
      { face: 'alarm', edge: 'severity', motion: true },
    ],
    [
      'stale fault: grey with the severity edge',
      { stale: true, online: true, alarm: 'high' },
      false,
      false,
      { face: 'stale', edge: 'severity', motion: false },
    ],
    [
      'offline fault',
      { stale: false, online: false, alarm: 'low' },
      false,
      false,
      { face: 'stale', edge: 'severity', motion: false },
    ],
    ['hovered', LIVE, true, false, { face: 'hover', edge: 'accent', motion: true }],
    ['selected', LIVE, false, true, { face: 'hover', edge: 'accent', motion: true }],
    ['hovered and selected', LIVE, true, true, { face: 'hover', edge: 'accent', motion: true }],
    [
      'hovered over an alarm',
      { ...LIVE, alarm: 'critical' },
      true,
      false,
      { face: 'hover', edge: 'accent', motion: true },
    ],
    [
      'selected over a stale fault',
      { stale: true, online: true, alarm: 'medium' },
      false,
      true,
      { face: 'hover', edge: 'accent', motion: false },
    ],
    [
      'hovered over stale',
      { ...LIVE, stale: true },
      true,
      false,
      { face: 'hover', edge: 'accent', motion: false },
    ],
  ];

  it.each(rows)('%s', (_name, flags, hovered, selected, expected) => {
    expect(lookOf(flags, hovered, selected)).toMatchObject(expected);
  });

  it.each(INCIDENT_SEVERITIES)(
    'keeps the %s severity whatever the face and the edge are',
    (severity) => {
      expect(lookOf({ ...LIVE, alarm: severity }, false, false).severity).toBe(severity);
      expect(lookOf({ stale: true, online: true, alarm: severity }, false, false).severity).toBe(
        severity,
      );
      expect(lookOf({ ...LIVE, alarm: severity }, true, false).severity).toBe(severity);
    },
  );

  it('has no severity for an asset with no open incident', () => {
    expect(lookOf(LIVE, false, false).severity).toBeNull();
    expect(lookOf({ ...LIVE, stale: true }, true, true).severity).toBeNull();
  });

  it('is decided by the flags alone: a resolved incident clears the alarm look', () => {
    expect(lookOf({ ...LIVE, alarm: 'high' }, false, false).face).toBe('alarm');
    expect(lookOf(LIVE, false, false)).toEqual({
      ghost: false,
      face: 'idle',
      edge: 'idle',
      severity: null,
      motion: true,
    });
  });
});

describe('lookOf with a ghost (V2-15.7)', () => {
  it('is not faded unless it is asked to be', () => {
    expect(lookOf(LIVE, false, false).ghost).toBe(false);
    expect(lookOf(LIVE, true, true).ghost).toBe(false);
  });

  it('keeps the face and the edge its flags give it: a faded state, not a colour', () => {
    const cases: LookFlags[] = [
      LIVE,
      { ...LIVE, stale: true },
      { ...LIVE, online: false },
      { ...LIVE, alarm: 'high' },
      { stale: true, online: true, alarm: 'critical' },
    ];
    for (const flags of cases) {
      const plain = lookOf(flags, false, false);
      const faded = lookOf(flags, false, false, true);

      expect(faded.ghost).toBe(true);
      expect({ ...faded, ghost: false }).toEqual(plain);
    }
  });

  it('is the token’s opacity', () => {
    expect(GHOST_OPACITY).toBe(twinColors.ghostOpacity);
    expect(GHOST_OPACITY).toBeGreaterThan(0);
    expect(GHOST_OPACITY).toBeLessThan(1);
  });
});

describe('faceColour and edgeColour', () => {
  const base = twinColors.neutral;
  const looks = (severity: IncidentSeverity | null): AssetLook[] =>
    [false, true].flatMap((stale) =>
      [true, false].flatMap((online) =>
        [false, true].flatMap((picked) => [
          lookOf({ stale, online, alarm: severity }, picked, false),
        ]),
      ),
    );

  it('keeps a live asset’s base, and gives a stale one the one grey', () => {
    expect(faceColour(base, lookOf(LIVE, false, false))).toBe(base);
    for (const name of MATERIAL_NAMES) {
      const color = materialSpec(name).color;
      expect(faceColour(color, lookOf({ ...LIVE, stale: true }, false, false))).toBe(
        twinColors.stale.top,
      );
    }
  });

  it('tints an alarmed asset’s base with its severity, and hovering mixes the accent', () => {
    expect(faceColour(base, lookOf({ ...LIVE, alarm: 'high' }, false, false))).toBe(
      tintFor('high', base),
    );
    expect(faceColour(base, lookOf(LIVE, true, false))).toBe(
      mixInto(base, mapColors.accent, HOVER_MIX),
    );
  });

  it('gives the edge of each look: the idle outline, the dim dash, the severity and the accent', () => {
    expect(edgeColour(lookOf(LIVE, false, false))).toBe(twinColors.edge);
    expect(edgeColour(lookOf({ ...LIVE, stale: true }, false, false))).toBe(twinColors.staleEdge);
    for (const severity of INCIDENT_SEVERITIES) {
      expect(edgeColour(lookOf({ ...LIVE, alarm: severity }, false, false))).toBe(
        mapColors.severity[severity],
      );
      expect(edgeColour(lookOf({ stale: true, online: true, alarm: severity }, false, false))).toBe(
        mapColors.severity[severity],
      );
    }
    expect(edgeColour(lookOf(LIVE, true, false))).toBe(mapColors.accent);
  });

  // AC4: no colour other than severity, the accent and the neutral materials. Every colour the table can give,
  // over every look and every material, is built from those and from nothing else.
  it('can only give a neutral material, a stale tone, the accent, a severity, or a fixed-weight mix of one into a neutral', () => {
    const bases = MATERIAL_NAMES.map((name) => materialSpec(name).color);
    const allowedFaces = new Set<string>([
      ...bases,
      twinColors.stale.top,
      ...bases.map((color) => mixInto(color, mapColors.accent, HOVER_MIX)),
      ...bases.flatMap((color) => INCIDENT_SEVERITIES.map((severity) => tintFor(severity, color))),
    ]);
    const allowedEdges = new Set<string>([
      twinColors.edge,
      twinColors.staleEdge,
      mapColors.accent,
      ...INCIDENT_SEVERITIES.map((severity) => mapColors.severity[severity]),
    ]);

    for (const severity of [null, ...INCIDENT_SEVERITIES]) {
      for (const look of looks(severity)) {
        expect(allowedEdges.has(edgeColour(look))).toBe(true);
        for (const color of bases) expect(allowedFaces.has(faceColour(color, look))).toBe(true);
      }
    }
  });

  it('never lets a severity leak into a face that is not alarmed', () => {
    for (const severity of INCIDENT_SEVERITIES) {
      expect(faceColour(base, { face: 'idle', severity })).toBe(base);
      expect(faceColour(base, { face: 'stale', severity })).toBe(twinColors.stale.top);
    }
  });
});

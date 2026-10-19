import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import {
  BoxGeometry,
  type BufferAttribute,
  Color,
  Group,
  type LineSegments,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';
import { edgeIndices } from '../lib/twinBoxes';
import { type HoverState, NO_HOVER } from '../lib/twinHover';
import { EDGE_DASH_M, edgeColour, faceColour, lookOf } from '../lib/twinMaterials';
import type { PlacedAsset } from '../lib/twinPlacement';
import type { AssetFlags, TwinFeed } from '../realtime/twinFeed';
import { mapColors, twinColors } from '../styles/tokens';
import {
  buildTemplate,
  createMaterialTable,
  instantiate,
  type MaterialTable,
  OUTLINE_NAME,
} from './classModel';
import {
  type BoxLayers,
  createBoxLayers,
  type ModelLookTarget,
  useBoxLooks,
  useModelLooks,
} from './useAssetLooks';

/*
 * The painters are driven by hand like `useBoundParts`: `useFrame` is replaced by a function that keeps the
 * callback, a test calls it, the feed is a fake reader and the objects are real three ones (no WebGL needed).
 */
const frame = vi.hoisted(() => ({ callback: null as null | (() => void) }));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: () => void) => {
    frame.callback = callback;
  },
}));

const LIVE: AssetFlags = { stale: false, online: true, alarm: null, ruleKey: null };
const STALE: AssetFlags = { ...LIVE, stale: true };
const OFFLINE: AssetFlags = { ...LIVE, online: false };
const alarmed = (severity: AssetFlags['alarm']): AssetFlags => ({ ...LIVE, alarm: severity });

/** A fake feed whose flags a test sets per asset; an asset with none is live. */
function createRig() {
  const flags = new Map<string, AssetFlags>();
  const reader = { flags: (code: string) => flags.get(code) ?? LIVE };
  const feed = { read: () => reader } as unknown as TwinFeed;
  return { feed, flags };
}

function meshOf(name: string, material: string): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: material }));
  mesh.name = name;
  return mesh;
}

/** A model of two parts, one static and one bound, as a template and the table it was built with. */
function makeTemplate() {
  const root = new Group();
  root.name = 'CoolingTower';
  root.add(meshOf('Casing', 'Part'));
  const fan = meshOf('FanBlade', 'Blade');
  fan.userData = { bind: 'fanSpeedRpm', motion: 'spin', axis: 'y', range: [0, 1800] };
  root.add(fan);
  const loaded = new Group();
  loaded.add(root);
  const table = createMaterialTable();
  return { template: buildTemplate(loaded, table), table };
}

function targetOf(
  assetCode: string,
  template: ReturnType<typeof makeTemplate>['template'],
  parts: ReadonlySet<string> = new Set(),
): ModelLookTarget {
  return { assetCode, object: instantiate(template), materials: template.materials, parts };
}

/** The ref `useHoverRef` keeps, here set by hand; nothing is hovered at first. */
const hoverRef = (): { current: HoverState } => ({ current: NO_HOVER });

const meshes = (object: Object3D): Mesh[] => {
  const found: Mesh[] = [];
  object.traverse((node) => {
    if ((node as Mesh).isMesh) found.push(node as Mesh);
  });
  return found;
};

const outlines = (object: Object3D): LineSegments[] => {
  const found: LineSegments[] = [];
  object.traverse((node) => {
    if (node.name === OUTLINE_NAME) found.push(node as LineSegments);
  });
  return found;
};

const baseName = (mesh: Mesh) => (mesh.material as MeshStandardMaterial).name;

function mount(
  feed: TwinFeed | null,
  targets: readonly ModelLookTarget[],
  hover: RefObject<HoverState> = hoverRef(),
) {
  return renderHook(
    (props: { targets: readonly ModelLookTarget[] }) => useModelLooks(feed, props.targets, hover),
    {
      initialProps: { targets },
    },
  );
}

const tick = () => frame.callback!();

describe('useModelLooks', () => {
  let table: MaterialTable;
  let template: ReturnType<typeof makeTemplate>['template'];

  beforeEach(() => {
    frame.callback = null;
    ({ template, table } = makeTemplate());
  });

  it('leaves an idle model in its base materials with its outlines hidden', () => {
    const tower = targetOf('CT-01', template);
    const { feed } = createRig();
    mount(feed, [tower]);

    tick();

    for (const mesh of meshes(tower.object)) {
      expect(mesh.material).toBe(table.get(baseName(mesh)));
    }
    for (const outline of outlines(tower.object)) expect(outline.visible).toBe(false);
  });

  it.each(['low', 'medium', 'high', 'critical'] as const)(
    'tints an asset with an open %s incident and outlines it in the severity (AC1)',
    (severity) => {
      const tower = targetOf('CT-01', template);
      const { feed, flags } = createRig();
      mount(feed, [tower]);
      flags.set('CT-01', alarmed(severity));

      tick();

      for (const mesh of meshes(tower.object)) {
        expect(mesh.material).toBe(
          table.look(mesh.name === 'FanBlade' ? 'Blade' : 'Part', { face: 'alarm', severity }),
        );
      }
      for (const outline of outlines(tower.object)) {
        expect(outline.visible).toBe(true);
        expect(outline.material).toBe(table.line({ edge: 'severity', severity }));
      }
    },
  );

  it('clears both when the incident is resolved (AC1)', () => {
    const tower = targetOf('CT-01', template);
    const { feed, flags } = createRig();
    mount(feed, [tower]);
    flags.set('CT-01', alarmed('high'));
    tick();

    flags.set('CT-01', LIVE);
    tick();

    for (const mesh of meshes(tower.object)) {
      expect(mesh.material).toBe(table.get(baseName(mesh)));
    }
    for (const outline of outlines(tower.object)) expect(outline.visible).toBe(false);
  });

  it('greys a stale asset and dashes its outlines, and restores it when it is live (AC2)', () => {
    const tower = targetOf('CT-01', template);
    const { feed, flags } = createRig();
    mount(feed, [tower]);

    flags.set('CT-01', STALE);
    tick();
    for (const mesh of meshes(tower.object)) {
      expect(mesh.material).toBe(table.look(baseName(mesh), { face: 'stale', severity: null }));
    }
    for (const outline of outlines(tower.object)) {
      expect(outline.visible).toBe(true);
      expect(outline.material).toBe(table.line({ edge: 'stale-dashed', severity: null }));
      expect(outline.material).toHaveProperty('isLineDashedMaterial', true);
    }

    flags.set('CT-01', LIVE);
    tick();
    for (const mesh of meshes(tower.object)) expect(mesh.material).toBe(table.get(baseName(mesh)));
    for (const outline of outlines(tower.object)) expect(outline.visible).toBe(false);
  });

  it('looks stale for an offline asset too', () => {
    const tower = targetOf('CT-01', template);
    const { feed, flags } = createRig();
    mount(feed, [tower]);

    flags.set('CT-01', OFFLINE);
    tick();

    for (const mesh of meshes(tower.object)) {
      expect(mesh.material).toBe(table.look(baseName(mesh), { face: 'stale', severity: null }));
    }
  });

  it('shows a stale fault grey with a solid severity outline (AC3)', () => {
    const tower = targetOf('CT-01', template);
    const { feed, flags } = createRig();
    mount(feed, [tower]);

    flags.set('CT-01', { ...alarmed('high'), stale: true });
    tick();

    for (const mesh of meshes(tower.object)) {
      expect(mesh.material).toBe(table.look(baseName(mesh), { face: 'stale', severity: null }));
    }
    for (const outline of outlines(tower.object)) {
      expect(outline.visible).toBe(true);
      expect(outline.material).toBe(table.line({ edge: 'severity', severity: 'high' }));
      expect(outline.material).not.toHaveProperty('isLineDashedMaterial', true);
    }
  });

  it('touches only the asset whose flags changed', () => {
    const one = targetOf('CT-01', template);
    const two = targetOf('CT-02', template);
    const { feed, flags } = createRig();
    mount(feed, [one, two]);
    tick();

    flags.set('CT-01', STALE);
    tick();

    for (const mesh of meshes(one.object)) {
      expect(mesh.material).toBe(table.look(baseName(mesh), { face: 'stale', severity: null }));
    }
    for (const mesh of meshes(two.object)) expect(mesh.material).toBe(table.get(baseName(mesh)));
    for (const outline of outlines(two.object)) expect(outline.visible).toBe(false);
  });

  it('shares one pooled material between assets with the same look', () => {
    const one = targetOf('CT-01', template);
    const two = targetOf('CT-02', template);
    const { feed, flags } = createRig();
    mount(feed, [one, two]);
    flags.set('CT-01', alarmed('high'));
    flags.set('CT-02', alarmed('high'));

    tick();

    expect(meshes(one.object)[0]!.material).toBe(meshes(two.object)[0]!.material);
  });

  it('writes nothing when the flags object is the same, or changes only in what the look ignores', () => {
    const tower = targetOf('CT-01', template);
    const { feed, flags } = createRig();
    mount(feed, [tower]);
    flags.set('CT-01', alarmed('high'));
    tick();
    const sentinel = new MeshStandardMaterial();
    for (const mesh of meshes(tower.object)) mesh.material = sentinel;

    tick();
    expect(meshes(tower.object)[0]!.material).toBe(sentinel);

    // The rule's key arriving is a new flags object and the same look.
    flags.set('CT-01', { ...alarmed('high'), ruleKey: 'motorTempC' });
    tick();
    expect(meshes(tower.object)[0]!.material).toBe(sentinel);
  });

  it('paints instances that appear later', () => {
    const { feed, flags } = createRig();
    const view = mount(feed, [targetOf('CT-01', template)]);
    flags.set('CT-02', STALE);
    tick();

    const later = targetOf('CT-02', template);
    view.rerender({ targets: [later] });
    tick();

    for (const mesh of meshes(later.object)) {
      expect(mesh.material).toBe(table.look(baseName(mesh), { face: 'stale', severity: null }));
    }
  });

  // V2-15.5: hover, from the ref the canvas keeps from the store.
  describe('hover', () => {
    const hoverLook = { face: 'hover', severity: null } as const;

    it('tints a hovered asset and outlines it in the accent, and restores it when the pointer leaves', () => {
      const tower = targetOf('CT-01', template);
      const { feed } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);
      tick();

      hover.current = { asset: 'CT-01', part: null };
      tick();
      for (const mesh of meshes(tower.object)) {
        expect(mesh.material).toBe(table.look(baseName(mesh), hoverLook));
      }
      for (const outline of outlines(tower.object)) {
        expect(outline.visible).toBe(true);
        expect(outline.material).toBe(table.line({ edge: 'accent', severity: null }));
      }

      hover.current = NO_HOVER;
      tick();
      for (const mesh of meshes(tower.object)) {
        expect(mesh.material).toBe(table.get(baseName(mesh)));
      }
      for (const outline of outlines(tower.object)) expect(outline.visible).toBe(false);
    });

    it('shows the hover look over an alarm while hovered and the severity again when it leaves (AC2)', () => {
      const tower = targetOf('CT-01', template);
      const { feed, flags } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);
      flags.set('CT-01', alarmed('high'));
      tick();

      hover.current = { asset: 'CT-01', part: null };
      tick();
      for (const mesh of meshes(tower.object)) {
        expect(mesh.material).toBe(table.look(baseName(mesh), hoverLook));
      }

      hover.current = NO_HOVER;
      tick();
      for (const mesh of meshes(tower.object)) {
        expect(mesh.material).toBe(table.look(baseName(mesh), { face: 'alarm', severity: 'high' }));
      }
      for (const outline of outlines(tower.object)) {
        expect(outline.material).toBe(table.line({ edge: 'severity', severity: 'high' }));
      }
    });

    it('shows the hover look over a stale asset, and the dash again after it', () => {
      const tower = targetOf('CT-01', template);
      const { feed, flags } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);
      flags.set('CT-01', STALE);
      tick();

      hover.current = { asset: 'CT-01', part: null };
      tick();
      for (const outline of outlines(tower.object)) {
        expect(outline.material).toBe(table.line({ edge: 'accent', severity: null }));
      }

      hover.current = NO_HOVER;
      tick();
      for (const outline of outlines(tower.object)) {
        expect(outline.material).toBe(table.line({ edge: 'stale-dashed', severity: null }));
      }
    });

    it('repaints only the asset the hover left and the one it came to', () => {
      const one = targetOf('CT-01', template);
      const two = targetOf('CT-02', template);
      const three = targetOf('CT-03', template);
      const { feed } = createRig();
      const hover = hoverRef();
      mount(feed, [one, two, three], hover);
      hover.current = { asset: 'CT-01', part: null };
      tick();
      const sentinel = new MeshStandardMaterial();
      for (const mesh of meshes(three.object)) mesh.material = sentinel;

      hover.current = { asset: 'CT-02', part: null };
      tick();

      for (const mesh of meshes(one.object)) expect(mesh.material).toBe(table.get(baseName(mesh)));
      for (const mesh of meshes(two.object)) {
        expect(mesh.material).toBe(table.look(baseName(mesh), hoverLook));
      }
      for (const mesh of meshes(three.object)) expect(mesh.material).toBe(sentinel);
    });

    it('writes nothing while the hover is the same object', () => {
      const tower = targetOf('CT-01', template);
      const { feed } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);
      hover.current = { asset: 'CT-01', part: null };
      tick();
      const sentinel = new MeshStandardMaterial();
      for (const mesh of meshes(tower.object)) mesh.material = sentinel;

      tick();

      for (const mesh of meshes(tower.object)) expect(mesh.material).toBe(sentinel);
    });

    it('leaves an asset alone when another one is hovered', () => {
      const tower = targetOf('CT-01', template);
      const { feed } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);

      hover.current = { asset: 'CT-02', part: null };
      tick();

      for (const mesh of meshes(tower.object))
        expect(mesh.material).toBe(table.get(baseName(mesh)));
    });

    it('tints a hovered part alone, and the asset around it keeps its own look', () => {
      const tower = targetOf('CT-01', template, new Set(['FanBlade']));
      const { feed, flags } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);
      flags.set('CT-01', alarmed('high'));
      tick();

      hover.current = { asset: 'CT-01', part: 'FanBlade' };
      tick();

      // The order of the meshes is the template's (static parts are merged), so they are found by name.
      const all = meshes(tower.object);
      const blade = all.find((mesh) => mesh.name === 'FanBlade')!;
      const rest = all.filter((mesh) => mesh !== blade);
      expect(rest.length).toBeGreaterThan(0);
      expect(blade.material).toBe(table.look('Blade', hoverLook));
      const bladeOutline = outlines(blade)[0]!;
      expect(bladeOutline.visible).toBe(true);
      expect(bladeOutline.material).toBe(table.line({ edge: 'accent', severity: null }));
      for (const mesh of rest) {
        expect(mesh.material).toBe(table.look('Part', { face: 'alarm', severity: 'high' }));
        expect(outlines(mesh)[0]!.material).toBe(
          table.line({ edge: 'severity', severity: 'high' }),
        );
      }
    });

    it('gives the part back to the asset when the pointer leaves it', () => {
      const tower = targetOf('CT-01', template, new Set(['FanBlade']));
      const { feed } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);
      hover.current = { asset: 'CT-01', part: 'FanBlade' };
      tick();

      hover.current = { asset: 'CT-01', part: null };
      tick();

      // The body is hovered now, so the whole asset is.
      for (const mesh of meshes(tower.object)) {
        expect(mesh.material).toBe(table.look(baseName(mesh), hoverLook));
      }

      hover.current = NO_HOVER;
      tick();
      for (const mesh of meshes(tower.object))
        expect(mesh.material).toBe(table.get(baseName(mesh)));
    });

    it('ignores a hovered node the model does not have', () => {
      const tower = targetOf('CT-01', template, new Set(['FanBlade']));
      const { feed } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);

      hover.current = { asset: 'CT-01', part: 'NoSuchNode' };
      tick();

      for (const mesh of meshes(tower.object))
        expect(mesh.material).toBe(table.get(baseName(mesh)));
    });

    it('ignores a hovered part of another asset', () => {
      const tower = targetOf('CT-01', template, new Set(['FanBlade']));
      const { feed } = createRig();
      const hover = hoverRef();
      mount(feed, [tower], hover);

      hover.current = { asset: 'CT-02', part: 'FanBlade' };
      tick();

      for (const mesh of meshes(tower.object))
        expect(mesh.material).toBe(table.get(baseName(mesh)));
    });
  });

  it('does nothing without a feed or without instances', () => {
    const tower = targetOf('CT-01', template);
    mount(null, [tower]);
    expect(() => tick()).not.toThrow();
    for (const mesh of meshes(tower.object)) expect(mesh.material).toBe(table.get(baseName(mesh)));

    const { feed } = createRig();
    mount(feed, []);
    expect(() => tick()).not.toThrow();
  });
});

// --- boxes ----------------------------------------------------------------------------------------------------

const placed = (code: string, x: number): PlacedAsset => ({
  code,
  classCode: 'ups',
  zoneId: 'Z',
  placement: 'outdoor',
  pose: { x, y: 0, z: 0, rotationY: 0 },
  size: { x: 2, y: 2, z: 2 },
});

/** The colour of vertex `v` of an attribute, as a hex string. */
const colourAt = (attribute: BufferAttribute, v: number): string =>
  `#${new Color().fromBufferAttribute(attribute, v).getHexString()}`;

const hexOf = (color: string): string => `#${new Color(color).getHexString()}`;

function mountBoxes(
  feed: TwinFeed | null,
  layers: BoxLayers | null,
  hover: RefObject<HoverState> = hoverRef(),
) {
  return renderHook(
    (props: { layers: BoxLayers | null }) => useBoxLooks(feed, props.layers, hover),
    {
      initialProps: { layers },
    },
  );
}

describe('useBoxLooks', () => {
  /** The three boxes' faces and edges of vertex ranges, by code. */
  const faceColoursOf = (layers: BoxLayers, code: string): string[] => {
    const range = layers.ranges.find((r) => r.code === code)!;
    return Array.from({ length: range.vertexCount }, (_, i) =>
      colourAt(layers.faceColours, range.firstVertex + i),
    );
  };
  const edgeColoursOf = (layers: BoxLayers, code: string): string[] => {
    const range = layers.ranges.find((r) => r.code === code)!;
    return Array.from({ length: 2 * range.segmentCount }, (_, i) =>
      colourAt(layers.edgeColours, 2 * range.firstSegment + i),
    );
  };
  const indexOf = (geometry: BoxLayers['solid']): number[] => Array.from(geometry.index!.array);

  let layers: BoxLayers;

  beforeEach(() => {
    frame.callback = null;
    layers = createBoxLayers([placed('A', 0), placed('B', 10), placed('C', 20)]);
  });

  it('starts every box neutral with the idle outline, every segment solid and no dashed one', () => {
    for (const code of ['A', 'B', 'C']) {
      expect(new Set(faceColoursOf(layers, code))).toEqual(new Set([hexOf(twinColors.neutral)]));
      expect(new Set(edgeColoursOf(layers, code))).toEqual(new Set([hexOf(twinColors.edge)]));
    }
    expect(indexOf(layers.solid)).toEqual(edgeIndices(layers.ranges, new Set()).solid);
    expect(indexOf(layers.dashed)).toEqual([]);
  });

  it('shares the edge vertex data between the two layers, and has the distances a dash needs', () => {
    for (const name of ['position', 'color', 'lineDistance'] as const) {
      expect(layers.solid.getAttribute(name)).toBe(layers.dashed.getAttribute(name));
    }
    expect(layers.solid.getAttribute('lineDistance').count).toBe(
      layers.solid.getAttribute('position').count,
    );
    expect(EDGE_DASH_M).toBeGreaterThan(0);
  });

  it('is not painted when idle: nothing is rewritten', () => {
    const { feed } = createRig();
    mountBoxes(feed, layers);
    const version = layers.faceColours.version;

    tick();
    tick();

    // The first frame paints each box idle once; nothing after it does.
    const after = layers.faceColours.version;
    tick();
    expect(layers.faceColours.version).toBe(after);
    expect(after).toBeGreaterThanOrEqual(version);
    expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.neutral)]));
  });

  it.each(['low', 'medium', 'high', 'critical'] as const)(
    'tints the box with an open %s incident and outlines it in the severity, and no other box (AC1)',
    (severity) => {
      const { feed, flags } = createRig();
      mountBoxes(feed, layers);
      flags.set('B', alarmed(severity));

      tick();

      const look = lookOf({ stale: false, online: true, alarm: severity }, false, false);
      expect(new Set(faceColoursOf(layers, 'B'))).toEqual(
        new Set([hexOf(faceColour(twinColors.neutral, look))]),
      );
      expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(edgeColour(look))]));
      expect(hexOf(edgeColour(look))).toBe(hexOf(mapColors.severity[severity]));
      for (const other of ['A', 'C']) {
        expect(new Set(faceColoursOf(layers, other))).toEqual(new Set([hexOf(twinColors.neutral)]));
        expect(new Set(edgeColoursOf(layers, other))).toEqual(new Set([hexOf(twinColors.edge)]));
      }
      // An alarm edge is solid.
      expect(indexOf(layers.dashed)).toEqual([]);
    },
  );

  it('clears both when the incident is resolved (AC1)', () => {
    const { feed, flags } = createRig();
    mountBoxes(feed, layers);
    flags.set('B', alarmed('high'));
    tick();

    flags.set('B', LIVE);
    tick();

    expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.neutral)]));
    expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.edge)]));
  });

  it('greys a stale box and moves its segments to the dashed layer, and live moves them back (AC2)', () => {
    const { feed, flags } = createRig();
    mountBoxes(feed, layers);
    const segmentsOfB = edgeIndices(layers.ranges, new Set(['B'])).dashed;

    flags.set('B', STALE);
    tick();
    expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.stale.top)]));
    expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.staleEdge)]));
    expect(indexOf(layers.dashed)).toEqual(segmentsOfB);
    expect(indexOf(layers.solid)).toEqual(edgeIndices(layers.ranges, new Set(['B'])).solid);

    flags.set('B', LIVE);
    tick();
    expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.neutral)]));
    expect(indexOf(layers.dashed)).toEqual([]);
    expect(indexOf(layers.solid)).toEqual(edgeIndices(layers.ranges, new Set()).solid);
  });

  it('keeps a stale fault grey with a solid severity edge, in the solid layer (AC3)', () => {
    const { feed, flags } = createRig();
    mountBoxes(feed, layers);

    flags.set('B', { ...alarmed('high'), stale: true });
    tick();

    expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.stale.top)]));
    expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(mapColors.severity.high)]));
    expect(indexOf(layers.dashed)).toEqual([]);
    expect(indexOf(layers.solid)).toEqual(edgeIndices(layers.ranges, new Set()).solid);
  });

  it('looks stale for an offline box too', () => {
    const { feed, flags } = createRig();
    mountBoxes(feed, layers);

    flags.set('C', OFFLINE);
    tick();

    expect(new Set(faceColoursOf(layers, 'C'))).toEqual(new Set([hexOf(twinColors.stale.top)]));
    expect(indexOf(layers.dashed)).toEqual(edgeIndices(layers.ranges, new Set(['C'])).dashed);
  });

  it('keeps boxes with different looks apart', () => {
    const { feed, flags } = createRig();
    mountBoxes(feed, layers);

    flags.set('A', STALE);
    flags.set('C', alarmed('critical'));
    tick();

    expect(new Set(faceColoursOf(layers, 'A'))).toEqual(new Set([hexOf(twinColors.stale.top)]));
    expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.neutral)]));
    expect(new Set(faceColoursOf(layers, 'C'))).toEqual(
      new Set([hexOf(faceColour(twinColors.neutral, lookOf(alarmed('critical'), false, false)))]),
    );
    expect(indexOf(layers.dashed)).toEqual(edgeIndices(layers.ranges, new Set(['A'])).dashed);
  });

  it('writes nothing for the same flags object, or a change the look ignores', () => {
    const { feed, flags } = createRig();
    mountBoxes(feed, layers);
    flags.set('B', alarmed('high'));
    tick();
    const version = layers.faceColours.version;

    tick();
    expect(layers.faceColours.version).toBe(version);

    flags.set('B', { ...alarmed('high'), ruleKey: 'motorTempC' });
    tick();
    expect(layers.faceColours.version).toBe(version);
  });

  it('paints layers that are rebuilt', () => {
    const { feed, flags } = createRig();
    const view = mountBoxes(feed, layers);
    flags.set('B', STALE);
    tick();

    const rebuilt = createBoxLayers([placed('A', 0), placed('B', 10)]);
    view.rerender({ layers: rebuilt });
    tick();

    expect(new Set(faceColoursOf(rebuilt, 'B'))).toEqual(new Set([hexOf(twinColors.stale.top)]));
    expect(indexOf(rebuilt.dashed)).toEqual(edgeIndices(rebuilt.ranges, new Set(['B'])).dashed);
  });

  // V2-15.5: hover, from the ref the canvas keeps from the store.
  describe('hover', () => {
    const hovered = lookOf(LIVE, true, false);

    it('tints a hovered box and outlines it in the accent, and no other box, and restores it on leaving', () => {
      const { feed } = createRig();
      const hover = hoverRef();
      mountBoxes(feed, layers, hover);
      tick();

      hover.current = { asset: 'B', part: null };
      tick();
      expect(new Set(faceColoursOf(layers, 'B'))).toEqual(
        new Set([hexOf(faceColour(twinColors.neutral, hovered))]),
      );
      expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(mapColors.accent)]));
      for (const other of ['A', 'C']) {
        expect(new Set(faceColoursOf(layers, other))).toEqual(new Set([hexOf(twinColors.neutral)]));
      }

      hover.current = NO_HOVER;
      tick();
      expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.neutral)]));
      expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.edge)]));
    });

    it('shows the hover look over an alarm while hovered and the severity again after it (AC2)', () => {
      const { feed, flags } = createRig();
      const hover = hoverRef();
      mountBoxes(feed, layers, hover);
      flags.set('B', alarmed('high'));
      tick();
      const alarm = lookOf(alarmed('high'), false, false);

      hover.current = { asset: 'B', part: null };
      tick();
      expect(new Set(faceColoursOf(layers, 'B'))).toEqual(
        new Set([hexOf(faceColour(twinColors.neutral, hovered))]),
      );

      hover.current = NO_HOVER;
      tick();
      expect(new Set(faceColoursOf(layers, 'B'))).toEqual(
        new Set([hexOf(faceColour(twinColors.neutral, alarm))]),
      );
      expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(
        new Set([hexOf(mapColors.severity.high)]),
      );
    });

    it('takes a hovered stale box out of the dashed layer, and puts it back after', () => {
      const { feed, flags } = createRig();
      const hover = hoverRef();
      mountBoxes(feed, layers, hover);
      flags.set('B', STALE);
      tick();
      expect(indexOf(layers.dashed)).toEqual(edgeIndices(layers.ranges, new Set(['B'])).dashed);

      hover.current = { asset: 'B', part: null };
      tick();
      expect(indexOf(layers.dashed)).toEqual([]);
      expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(mapColors.accent)]));

      hover.current = NO_HOVER;
      tick();
      expect(indexOf(layers.dashed)).toEqual(edgeIndices(layers.ranges, new Set(['B'])).dashed);
      expect(new Set(edgeColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.staleEdge)]));
    });

    it('repaints only the box the hover left and the one it came to', () => {
      const { feed } = createRig();
      const hover = hoverRef();
      mountBoxes(feed, layers, hover);
      hover.current = { asset: 'A', part: null };
      tick();
      const rangeC = layers.ranges.find((r) => r.code === 'C')!;
      layers.faceColours.setXYZ(rangeC.firstVertex, 1, 0, 1);

      hover.current = { asset: 'B', part: null };
      tick();

      expect(new Set(faceColoursOf(layers, 'A'))).toEqual(new Set([hexOf(twinColors.neutral)]));
      expect(new Set(faceColoursOf(layers, 'B'))).toEqual(
        new Set([hexOf(faceColour(twinColors.neutral, hovered))]),
      );
      expect(colourAt(layers.faceColours, rangeC.firstVertex)).toBe('#ff00ff');
    });

    it('does not tint a box for a hovered part: a box has none', () => {
      const { feed } = createRig();
      const hover = hoverRef();
      mountBoxes(feed, layers, hover);

      hover.current = { asset: 'B', part: 'FanBlade' };
      tick();

      expect(new Set(faceColoursOf(layers, 'B'))).toEqual(new Set([hexOf(twinColors.neutral)]));
    });

    it('writes nothing while the hover is the same object', () => {
      const { feed } = createRig();
      const hover = hoverRef();
      mountBoxes(feed, layers, hover);
      hover.current = { asset: 'B', part: null };
      tick();
      const version = layers.faceColours.version;

      tick();

      expect(layers.faceColours.version).toBe(version);
    });
  });

  it('does nothing without a feed or without boxes', () => {
    mountBoxes(null, layers);
    expect(() => tick()).not.toThrow();
    expect(new Set(faceColoursOf(layers, 'A'))).toEqual(new Set([hexOf(twinColors.neutral)]));

    const { feed } = createRig();
    mountBoxes(feed, null);
    expect(() => tick()).not.toThrow();
  });
});

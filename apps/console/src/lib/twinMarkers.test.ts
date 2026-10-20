import type { Camera, LngLat } from '@occ/contracts';
import { offsetM } from './geo';
import {
  atlasLayout,
  cameraMarkers,
  MARKER_MARGIN_PX,
  type MarkerPlacement,
  type SpriteSize,
  spriteInstances,
  STEM_PX,
  STILL,
} from './twinMarkers';
import { makeFrame } from './twinScene';

const ANCHOR: LngLat = [108.4415, 11.953];
const frame = makeFrame(ANCHOR);

/** A point `east` / `north` metres from the anchor, as the seed builds its zones. */
const at = (east: number, north: number): LngLat => offsetM(ANCHOR, east, north);

const camera = (index: number, online = true): Camera => ({
  id: `cam-${index}`,
  code: `CAM-${index}`,
  name: `Camera ${index}`,
  zoneId: 'zone-1',
  position: at(index * 10 - 100, index * 5 - 50),
  online,
  fieldOfView: null,
});

describe('the pixel rules', () => {
  it('puts the stem 8 px under the marker, which starts 1 px inside its bitmap', () => {
    expect(STEM_PX).toBe(8);
    expect(MARKER_MARGIN_PX).toBe(1);
  });
});

describe('cameraMarkers', () => {
  it('stands each marker on the ground at its camera, east as +x and north as −z', () => {
    const [marker] = cameraMarkers([{ ...camera(0), position: at(30, 40) }], frame);

    expect(marker!.id).toBe('cam-0');
    expect(marker!.position[0]).toBeCloseTo(30, 2);
    expect(marker!.position[1]).toBe(0);
    expect(marker!.position[2]).toBeCloseTo(-40, 2);
  });

  it('draws every camera, an offline one with its own image', () => {
    const cameras = Array.from({ length: 20 }, (_, i) => camera(i, i !== 3 && i !== 12));

    const markers = cameraMarkers(cameras, frame);

    expect(markers).toHaveLength(20);
    expect(markers.filter(({ image }) => image === 'camera-online')).toHaveLength(18);
    expect(markers.filter(({ image }) => image === 'camera-offline').map(({ id }) => id)).toEqual([
      'cam-3',
      'cam-12',
    ]);
  });

  it('keeps the cameras in their order', () => {
    const markers = cameraMarkers([camera(2), camera(0), camera(1)], frame);

    expect(markers.map(({ id }) => id)).toEqual(['cam-2', 'cam-0', 'cam-1']);
  });

  it('has nothing to draw without cameras', () => {
    expect(cameraMarkers([], frame)).toEqual([]);
  });
});

describe('atlasLayout', () => {
  const sizes: SpriteSize[] = [
    { id: 'a', width: 28, height: 36 },
    { id: 'b', width: 28, height: 36 },
  ];

  it('lays the cells in a row with one pixel between them and none around', () => {
    expect(atlasLayout(sizes)).toEqual({
      width: 57,
      height: 36,
      cells: [
        { id: 'a', width: 28, height: 36, x: 0, y: 0 },
        { id: 'b', width: 28, height: 36, x: 29, y: 0 },
      ],
    });
  });

  it('takes another padding, and none', () => {
    expect(atlasLayout(sizes, 4).cells[1]!.x).toBe(32);
    expect(atlasLayout(sizes, 4).width).toBe(60);
    expect(atlasLayout(sizes, 0).width).toBe(56);
  });

  it('is as tall as the tallest cell', () => {
    const layout = atlasLayout([
      { id: 'a', width: 10, height: 20 },
      { id: 'b', width: 10, height: 50 },
    ]);

    expect(layout.height).toBe(50);
  });

  it('is empty for no cells, with no negative width', () => {
    expect(atlasLayout([])).toEqual({ width: 0, height: 0, cells: [] });
  });
});

describe('spriteInstances', () => {
  const atlas = atlasLayout([
    { id: 'camera-online', width: 28, height: 44 },
    { id: 'camera-offline', width: 28, height: 44 },
  ]);
  const placement = (id: string, image: string, x: number): MarkerPlacement => ({
    id,
    image,
    position: [x, 0, -x],
  });

  it('flattens the anchors in the placements order', () => {
    const instances = spriteInstances(
      [placement('a', 'camera-offline', 5), placement('b', 'camera-online', 7)],
      atlas,
      2,
    );

    expect(instances.count).toBe(2);
    expect(instances.anchors).toEqual([5, 0, -5, 7, 0, -7]);
  });

  it('gives the cell as a UV rectangle, with v measured up from the bottom of the atlas', () => {
    const { rects } = spriteInstances(
      [placement('a', 'camera-online', 0), placement('b', 'camera-offline', 0)],
      atlas,
      2,
    );

    // The atlas is 57 × 44 px; both cells fill its height, so v runs 0 … 1.
    expect(rects.slice(0, 4)).toEqual([0, 0, 28 / 57, 1]);
    expect(rects.slice(4)).toEqual([29 / 57, 0, 1, 1]);
  });

  it('puts a cell shorter than the atlas at the top of it, which is high v', () => {
    const uneven = atlasLayout([
      { id: 'tall', width: 10, height: 40 },
      { id: 'short', width: 10, height: 10 },
    ]);

    const { rects } = spriteInstances([placement('a', 'short', 0)], uneven, 1);

    // The short cell spans y 0 … 10 of 40 from the top: v from 0.75 to 1.
    expect(rects).toEqual([11 / 21, 0.75, 1, 1]);
  });

  it('gives the size in CSS pixels, the bitmap divided by its ratio', () => {
    const { sizes } = spriteInstances([placement('a', 'camera-online', 0)], atlas, 2);

    expect(sizes).toEqual([14, 22]);
  });

  it('skips a marker whose image is not in the atlas and keeps the others', () => {
    const instances = spriteInstances(
      [
        placement('a', 'camera-online', 1),
        placement('b', 'mystery', 2),
        placement('c', 'camera-offline', 3),
      ],
      atlas,
      1,
    );

    expect(instances.count).toBe(2);
    expect(instances.anchors).toEqual([1, 0, -1, 3, 0, -3]);
    expect(instances.rects).toHaveLength(8);
    expect(instances.sizes).toHaveLength(4);
  });

  it('has no instances for no markers', () => {
    expect(spriteInstances([], atlas, 1)).toEqual({
      count: 0,
      anchors: [],
      rects: [],
      sizes: [],
      offsets: [],
      phases: [],
    });
  });

  it('gives a marker with no offset and no phase a zero offset and a still phase, as a camera has', () => {
    const { offsets, phases } = spriteInstances(
      [placement('a', 'camera-online', 1), placement('b', 'camera-offline', 2)],
      atlas,
      1,
    );

    expect(offsets).toEqual([0, 0, 0, 0]);
    expect(phases).toEqual([STILL, STILL]);
  });

  it('flattens a sprite’s offset and pulse phase beside its anchor, in the placements order', () => {
    const { anchors, offsets, phases } = spriteInstances(
      [
        { ...placement('a', 'camera-online', 1), offset: [12, 8], phase: 0 },
        placement('b', 'camera-offline', 2),
        { ...placement('c', 'camera-online', 3), offset: [-3.5, 20], phase: 0.25 },
      ],
      atlas,
      1,
    );

    expect(anchors).toEqual([1, 0, -1, 2, 0, -2, 3, 0, -3]);
    expect(offsets).toEqual([12, 8, 0, 0, -3.5, 20]);
    expect(phases).toEqual([0, STILL, 0.25]);
  });

  it('keeps a still sprite apart from a pulse that starts at phase zero', () => {
    const { phases } = spriteInstances(
      [{ ...placement('a', 'camera-online', 1), phase: 0 }, placement('b', 'camera-online', 2)],
      atlas,
      1,
    );

    // 0 is a valid cycle position; only a missing phase is still.
    expect(phases).toEqual([0, STILL]);
  });

  it('skips the offset and the phase of a marker it skips', () => {
    const { count, offsets, phases } = spriteInstances(
      [
        { ...placement('a', 'mystery', 1), offset: [1, 2], phase: 0.5 },
        { ...placement('b', 'camera-online', 2), offset: [3, 4], phase: 0.75 },
      ],
      atlas,
      1,
    );

    expect(count).toBe(1);
    expect(offsets).toEqual([3, 4]);
    expect(phases).toEqual([0.75]);
  });
});

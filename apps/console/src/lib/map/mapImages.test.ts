import type { Map as MapLibreMap } from 'maplibre-gl';
import { mapColors } from '../../styles/tokens';
import { cameraIcon, incidentTypeIcon, severityIcon, unknownIcon } from '../../ui/icons';
import {
  addClusterCountImage,
  glyphStyle,
  imageIdOf,
  type MarkerForm,
  markerSvg,
  registerMapImages,
  renderMarkerImages,
} from './mapImages';

const open: MarkerForm = {
  kind: 'incident',
  severity: 'critical',
  status: 'open',
  type: 'fire_alarm',
};
const acknowledged: MarkerForm = { ...open, status: 'acknowledged' };

/** Just enough of a map to register images on. */
function fakeMap(existing: string[] = []) {
  const images = new Map<string, { pixelRatio?: number }>();
  return {
    images,
    hasImage: vi.fn((id: string) => existing.includes(id) || images.has(id)),
    addImage: vi.fn((id: string, _image: unknown, options?: { pixelRatio?: number }) => {
      images.set(id, options ?? {});
    }),
  };
}

const asMap = (map: ReturnType<typeof fakeMap>) => map as unknown as MapLibreMap;

describe('glyphStyle', () => {
  it('draws an open incident glyph on the severity disc', () => {
    expect(glyphStyle(open)).toEqual({
      glyph: incidentTypeIcon('fire_alarm'),
      size: 14,
      strokeWidth: 2.6,
      color: mapColors.onAccent,
    });
  });

  it('draws an acknowledged incident glyph in its severity colour', () => {
    expect(glyphStyle(acknowledged).color).toBe(mapColors.severity.critical);
  });

  it('sizes the glyph with the severity', () => {
    const size = (severity: 'low' | 'medium' | 'high' | 'critical') =>
      glyphStyle({ ...open, severity }).size;

    expect([size('low'), size('medium'), size('high'), size('critical')]).toEqual([12, 12, 13, 14]);
  });

  it('draws resolved incidents and offline cameras in the tertiary tone', () => {
    expect(glyphStyle({ kind: 'resolved', type: 'medical' })).toMatchObject({
      glyph: incidentTypeIcon('medical'),
      size: 10,
      color: mapColors.textTertiary,
    });
    expect(glyphStyle({ kind: 'camera', online: false })).toMatchObject({
      glyph: cameraIcon(false),
      color: mapColors.textTertiary,
    });
    expect(glyphStyle({ kind: 'camera', online: true })).toMatchObject({
      glyph: cameraIcon(true),
      color: mapColors.textSecondary,
    });
  });

  it('draws an unknown type with the generic glyph', () => {
    expect(glyphStyle({ ...open, type: 'unknown' }).glyph).toBe(unknownIcon);
    expect(glyphStyle({ kind: 'resolved', type: 'unknown' }).glyph).toBe(unknownIcon);
  });
});

describe('imageIdOf', () => {
  it('uses the ids the features ask for', () => {
    expect(imageIdOf(open)).toBe('incident-critical-open-fire_alarm');
    expect(imageIdOf({ kind: 'resolved', type: 'medical' })).toBe('incident-resolved-medical');
    expect(imageIdOf({ kind: 'camera', online: false })).toBe('camera-offline');
  });

  it('names an asset diamond as the features do', () => {
    expect(imageIdOf({ kind: 'asset', look: 'normal' })).toBe('asset-normal');
    expect(imageIdOf({ kind: 'asset', look: 'nodata' })).toBe('asset-nodata');
    expect(imageIdOf({ kind: 'asset', look: 'fault', severity: 'high' })).toBe('asset-fault-high');
  });
});

describe('markerSvg', () => {
  it('fills an open marker with its severity and rings it with the ground', () => {
    const svg = markerSvg(open, '<svg/>', 1);

    expect(svg).toContain(
      `fill="${mapColors.severity.critical}" stroke="${mapColors.ground}" stroke-width="2.5"`,
    );
  });

  it('draws an acknowledged marker as a severity ring on the ground', () => {
    const svg = markerSvg(acknowledged, '<svg/>', 1);

    expect(svg).toContain(
      `fill="${mapColors.ground}" stroke="${mapColors.severity.critical}" stroke-width="3"`,
    );
  });

  it('scales the bitmap with the pixel ratio, not the drawing', () => {
    const svg = markerSvg(open, '<svg/>', 2);

    expect(svg).toContain('width="56" height="56" viewBox="0 0 28 28"');
  });

  it('centres the glyph on the disc', () => {
    // 28 px box, 14 px glyph for a critical marker.
    expect(markerSvg(open, '<svg id="glyph"/>', 1)).toContain(
      '<g transform="translate(7 7)"><svg id="glyph"/></g>',
    );
  });

  it('dashes the outline of an offline camera only', () => {
    expect(markerSvg({ kind: 'camera', online: false }, '', 1)).toContain('stroke-dasharray="2 2"');
    expect(markerSvg({ kind: 'camera', online: true }, '', 1)).not.toContain('stroke-dasharray');
  });
});

describe('asset diamond', () => {
  it('is a square of 8 px turned 45°, with no glyph', () => {
    const svg = markerSvg({ kind: 'asset', look: 'normal' }, '<svg id="glyph"/>', 1);

    expect(svg).toContain('width="8" height="8"');
    expect(svg).toContain('rotate(45)');
    expect(svg).not.toContain('id="glyph"');
    expect(svg).not.toContain('<g ');
  });

  it('draws a normal asset on its surface with a light edge', () => {
    const svg = markerSvg({ kind: 'asset', look: 'normal' }, '', 1);

    expect(svg).toContain(
      `fill="${mapColors.surface2}" stroke="${mapColors.textSecondary}" stroke-width="1.5"`,
    );
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('draws a fault as its severity at 30 % over the surface, edged in that severity', () => {
    const svg = markerSvg({ kind: 'asset', look: 'fault', severity: 'high' }, '', 1);

    expect(svg).toContain(`fill="${mapColors.surface2}"`);
    expect(svg).toContain(
      `fill="${mapColors.severity.high}" fill-opacity="0.3" stroke="${mapColors.severity.high}" stroke-width="1.5"`,
    );
  });

  it('draws no data as a dim dashed edge, which is the only cue that differs', () => {
    const svg = markerSvg({ kind: 'asset', look: 'nodata' }, '', 1);

    expect(svg).toContain(`stroke="${mapColors.staleEdge}"`);
    expect(svg).toContain('stroke-dasharray="2 2"');
  });

  it('scales the bitmap with the pixel ratio, not the drawing', () => {
    expect(markerSvg({ kind: 'asset', look: 'normal' }, '', 2)).toContain(
      'width="28" height="28" viewBox="0 0 14 14"',
    );
  });
});

describe('cluster badge', () => {
  const badge: MarkerForm = { kind: 'cluster-severity', severity: 'high' };

  it('is named by its severity', () => {
    expect(imageIdOf(badge)).toBe('cluster-severity-high');
  });

  it('draws the severity glyph, so the ring colour is not the only cue', () => {
    expect(glyphStyle(badge)).toEqual({
      glyph: severityIcon('high'),
      size: 10,
      strokeWidth: 2.6,
      color: mapColors.onAccent,
    });
  });

  it('is a small severity disc', () => {
    const svg = markerSvg(badge, '<svg/>', 2);

    expect(svg).toContain('width="32" height="32" viewBox="0 0 16 16"');
    expect(svg).toContain(`fill="${mapColors.severity.high}"`);
  });
});

describe('registerMapImages', () => {
  /** jsdom neither decodes images nor loads fonts. */
  class DecodedImage {
    src = '';
    decode = () => Promise.resolve();
  }

  beforeEach(() => {
    vi.stubGlobal('Image', DecodedImage);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: vi.fn(() => Promise.resolve([])) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'fonts');
  });

  it('registers every marker form once, at the device pixel ratio', async () => {
    const map = fakeMap();

    await registerMapImages(asMap(map), new AbortController().signal);

    // 4 severities × 2 statuses × (24 types + unknown), 25 resolved, 2 cameras, 4 cluster badges,
    // 6 asset diamonds (normal, no data, a fault per severity).
    expect(map.images.size).toBe(237);
    expect(map.images.get('incident-critical-open-fire_alarm')).toEqual({ pixelRatio: 1 });
    expect(map.images.has('incident-low-acknowledged-crowding')).toBe(true);
    expect(map.images.has('incident-resolved-suspicious_object')).toBe(true);
    expect(map.images.has('camera-offline')).toBe(true);
    expect(map.images.has('cluster-severity-critical')).toBe(true);
    expect(map.images.has('incident-critical-open-unknown')).toBe(true);
    expect(map.images.has('incident-resolved-unknown')).toBe(true);
    expect(map.images.has('asset-normal')).toBe(true);
    expect(map.images.has('asset-nodata')).toBe(true);
    for (const severity of ['low', 'medium', 'high', 'critical']) {
      expect(map.images.has(`asset-fault-${severity}`)).toBe(true);
    }
  });

  it('draws the asset diamonds with no glyph from the icon set', async () => {
    const map = fakeMap();

    await registerMapImages(asMap(map), new AbortController().signal);

    const [, image] = map.addImage.mock.calls.find(([id]) => id === 'asset-normal')!;
    const svg = decodeURIComponent((image as DecodedImage).src.split(',')[1]!);
    expect(svg.match(/<svg/g)).toHaveLength(1);
  });

  it('renders the glyph from the icon set into the image', async () => {
    const map = fakeMap();

    await registerMapImages(asMap(map), new AbortController().signal);

    const [, image] = map.addImage.mock.calls.find(([id]) => id === 'camera-online')!;
    const svg = decodeURIComponent((image as DecodedImage).src.split(',')[1]!);
    // The glyph's own <svg>, rendered by React with the camera stroke, inside the marker's.
    expect(svg.match(/<svg/g)).toHaveLength(2);
    expect(svg).toContain(`stroke="${mapColors.textSecondary}"`);
    expect(svg).toContain('stroke-width="2.4"');
  });

  it('adds nothing to a map removed while the images decode', async () => {
    const map = fakeMap();
    const loading = new AbortController();

    const registration = registerMapImages(asMap(map), loading.signal);
    loading.abort();
    await registration;

    expect(map.addImage).not.toHaveBeenCalled();
  });

  it('keeps images the map already has', async () => {
    const map = fakeMap(['camera-online']);

    await registerMapImages(asMap(map), new AbortController().signal);

    expect(map.addImage.mock.calls.map(([id]) => id)).not.toContain('camera-online');
  });
});

describe('addClusterCountImage', () => {
  it('leaves ids it does not own to someone else', () => {
    const map = fakeMap();

    expect(addClusterCountImage(asMap(map), 'incident-low-open-medical')).toBe(false);
    expect(map.addImage).not.toHaveBeenCalled();
  });

  it('does not draw a count the map already has', () => {
    const map = fakeMap(['cluster-count-3']);

    expect(addClusterCountImage(asMap(map), 'cluster-count-3')).toBe(false);
    expect(map.addImage).not.toHaveBeenCalled();
  });
});

describe('renderMarkerImages', () => {
  /** jsdom does not decode images. */
  class DecodedImage {
    src = '';
    decode = () => Promise.resolve();
  }
  /** The SVG behind the `index`th bitmap (the stubbed `Image` keeps its `src`). */
  const svgAt = (images: Awaited<ReturnType<typeof renderMarkerImages>>['images'], index: number) =>
    decodeURIComponent((images[index]![1] as unknown as DecodedImage).src.split(',')[1]!);

  const camera: MarkerForm = { kind: 'camera', online: true };
  const offline: MarkerForm = { kind: 'camera', online: false };
  const diamond: MarkerForm = { kind: 'asset', look: 'normal' };

  beforeEach(() => {
    vi.stubGlobal('Image', DecodedImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws one image per form, named as the map names it, with no map', async () => {
    const { ratio, images } = await renderMarkerImages([camera, offline, diamond, open]);

    expect(ratio).toBe(1);
    expect(images.map(([id]) => id)).toEqual([
      'camera-online',
      'camera-offline',
      'asset-normal',
      imageIdOf(open),
    ]);
  });

  it('renders a form that has a glyph with the icon set, and one that has none without', async () => {
    const { images } = await renderMarkerImages([camera, diamond]);

    // The glyph's own <svg>, rendered by React, inside the marker's; the asset diamond has no glyph.
    expect(svgAt(images, 0).match(/<svg/g)).toHaveLength(2);
    expect(svgAt(images, 1).match(/<svg/g)).toHaveLength(1);
  });

  it('draws the offline camera dashed and the online one solid, so colour is not the only cue', async () => {
    const { images } = await renderMarkerImages([camera, offline]);

    expect(svgAt(images, 0)).not.toContain('stroke-dasharray');
    expect(svgAt(images, 1)).toContain('stroke-dasharray="2 2"');
  });

  it('follows the device pixel ratio, rounded up to whole pixels, and reports it', async () => {
    const original = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.5 });
    try {
      const { ratio, images } = await renderMarkerImages([camera]);

      expect(ratio).toBe(2);
      // The camera's 14 px box is 28 device pixels; the drawing keeps its 14-unit viewBox.
      const svg = svgAt(images, 0);
      expect(svg).toContain('width="28"');
      expect(svg).toContain('viewBox="0 0 14 14"');
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: original });
    }
  });

  it('has nothing to draw for no forms', async () => {
    expect(await renderMarkerImages([])).toEqual({ ratio: 1, images: [] });
  });
});

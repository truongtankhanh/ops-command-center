import type { LngLat, SitePlan, Zone } from '@occ/contracts';
import { screen, within } from '@testing-library/react';
import { queryKeys } from '../api/queries';
import { MAX_ZONE_LABELS } from '../lib/twinScene';
import { createTestQueryClient, renderWithQueryClient } from '../test-utils';
import TwinStage from './TwinStage';

// R3F's canvas needs WebGL, which jsdom does not have; the stage's job here is to mount it.
vi.mock('./TwinCanvas', () => ({ TwinCanvas: () => <canvas aria-label="3D canvas" /> }));

const CENTER: LngLat = [108.4415, 11.953];

/** A square of about 90 m around a point `index` squares east of the centre. */
function zone(index: number, kind: Zone['kind'], name: string): Zone {
  const [lng, lat] = [CENTER[0] + index * 0.001, CENTER[1]];
  const half = 0.0004;
  return {
    id: `zone-${index}`,
    code: `Z-${index}`,
    name,
    kind,
    ...(kind === 'building' ? { heightM: 18 } : {}),
    polygon: [
      [lng - half, lat - half],
      [lng + half, lat - half],
      [lng + half, lat + half],
      [lng - half, lat + half],
      [lng - half, lat - half],
    ],
    center: [lng, lat],
  };
}

const PLAN: SitePlan = {
  id: 'plan-1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: CENTER,
  features: [],
};

/** The stage with the site's reference data already in the cache, as it is once the map has loaded. */
function renderStage(zones: Zone[]) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.sitePlan, PLAN);
  // The stage reads the cameras too; an unseeded query would try to fetch them.
  client.setQueryData(queryKeys.cameras, []);
  return renderWithQueryClient(<TwinStage />, client);
}

describe('TwinStage', () => {
  it('mounts the canvas', () => {
    renderStage([]);

    expect(screen.getByLabelText('3D canvas')).toBeInTheDocument();
  });

  it('labels every zone with its name', () => {
    renderStage([
      zone(0, 'building', 'Library'),
      zone(1, 'outdoor', 'Central Lawn'),
      zone(2, 'parking', 'West Parking'),
    ]);

    for (const name of ['Library', 'Central Lawn', 'West Parking']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('puts the buildings first, then the other zones in order', () => {
    renderStage([
      zone(0, 'outdoor', 'Central Lawn'),
      zone(1, 'building', 'Library'),
      zone(2, 'parking', 'West Parking'),
      zone(3, 'building', 'Data Center'),
    ]);

    const layer = screen.getByText('Library').parentElement!;
    expect([...layer.children].map((label) => label.textContent)).toEqual([
      'Library',
      'Data Center',
      'Central Lawn',
      'West Parking',
    ]);
  });

  it('hides the labels from assistive technology, which has the names elsewhere', () => {
    renderStage([zone(0, 'building', 'Library')]);

    expect(screen.getByText('Library').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no more than the cap', () => {
    renderStage(
      Array.from({ length: MAX_ZONE_LABELS + 6 }, (_, i) => zone(i, 'outdoor', `Lawn ${i}`)),
    );

    expect(screen.getAllByText(/^Lawn \d+$/)).toHaveLength(MAX_ZONE_LABELS);
  });

  it('draws the stage chrome over the canvas: the camera controls, the legend and the drag hint', () => {
    renderStage([zone(0, 'building', 'Library')]);

    const camera = screen.getByRole('group', { name: 'Camera' });
    expect(within(camera).getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Face north' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
    expect(screen.getByText(/Drag to rotate/)).toBeInTheDocument();
  });

  it('draws the chrome even before the scene has anything to show', () => {
    renderStage([]);

    expect(screen.getByRole('group', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
  });

  it('has no label without zones', () => {
    renderStage([]);

    expect(screen.queryByText(/./, { selector: 'span' })).not.toBeInTheDocument();
  });
});

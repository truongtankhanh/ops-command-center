import type { Incident, LngLat, Role, SitePlan, Zone } from '@occ/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { useSession } from '../auth/store';
import { MAX_ZONE_LABELS } from '../lib/twinScene';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
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

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'id',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** The stage with the site's reference data already in the cache, as it is once the map has loaded. */
function renderStage(zones: Zone[], incidents: Incident[] = []) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.sitePlan, PLAN);
  // The stage reads the cameras and the incidents too; an unseeded query would try to fetch them.
  client.setQueryData(queryKeys.cameras, []);
  client.setQueryData(queryKeys.incidents, incidents);
  return renderWithQueryClient(<TwinStage />, client);
}

/** The group that stands for the picture (`TwinView`); the camera controls are another group. */
const view = () => screen.getByRole('group', { name: /^3D view of/ });

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

  // The legend explains what is drawn; frame 06 (loading) has none, and it would sit under the loading card.
  it('draws the camera controls and the hint before the scene has anything to show, but not the legend', () => {
    renderStage([]);

    expect(screen.getByRole('group', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByText(/Drag to rotate/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument();
  });

  it('has no label without zones', () => {
    renderStage([]);

    expect(screen.queryByText(/./, { selector: 'span' })).not.toBeInTheDocument();
  });
  describe('for assistive technology', () => {
    afterEach(() => resetStore(useSession));

    it('is one group named by a summary of the site and its active incidents', () => {
      renderStage([zone(0, 'building', 'Library')], [incident({}), incident({ id: 'b' })]);

      expect(view()).toHaveAccessibleName(
        '3D view of Langbiang Tech Campus with 2 active incidents. Drag to rotate. The incident list and the Assets tab list everything shown here.',
      );
      expect(view()).toHaveAttribute('aria-roledescription', '3D view');
    });

    it('holds the canvas, hidden, and the zone labels', () => {
      renderStage([zone(0, 'building', 'Library')]);

      const canvas = screen.getByLabelText('3D canvas');
      expect(view()).toContainElement(canvas);
      expect(canvas.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(view()).not.toHaveAttribute('aria-hidden');
      expect(view()).toContainElement(screen.getByText('Library'));
    });

    it('leaves the camera controls, the legend and the hint outside the group', () => {
      renderStage([zone(0, 'building', 'Library')]);

      expect(view()).not.toContainElement(screen.getByRole('group', { name: 'Camera' }));
      expect(view()).not.toContainElement(screen.getByRole('button', { name: 'Legend' }));
      expect(view()).not.toContainElement(screen.getByText(/Drag to rotate/));
    });

    // One stop for the picture, then the controls' own stops (V2-12.10); Tab then leaves the stage.
    it('takes one tab stop for the view, then the legend and the camera controls, then Tab leaves', async () => {
      const user = userEvent.setup();
      renderStage([zone(0, 'building', 'Library')]);

      await user.tab();
      expect(view()).toHaveFocus();

      for (const name of [
        'Legend',
        'Face north',
        'Zoom in',
        'Zoom out',
        'Rotate left',
        'Rotate right',
        'Reset view',
      ]) {
        await user.tab();
        expect(screen.getByRole('button', { name })).toHaveFocus();
      }

      await user.tab();
      expect(document.body).toHaveFocus();
    });

    // Nothing in the stage reads a session or a permission (the console hides what a role cannot do, and
    // the 3D view does nothing a role cannot): this keeps it so.
    it.each<Role>(['viewer', 'technician', 'operator'])('is the same stage for a %s', (role) => {
      useSession.getState().signedIn({ displayName: 'Someone', roles: [role] });

      renderStage([zone(0, 'building', 'Library')], [incident({})]);

      expect(view()).toHaveAccessibleName(
        /^3D view of Langbiang Tech Campus with 1 active incident\./,
      );
      expect(
        within(screen.getByRole('group', { name: 'Camera' })).getAllByRole('button'),
      ).toHaveLength(5);
      expect(screen.getByRole('button', { name: 'Face north' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
    });
  });
});

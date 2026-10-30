import type { Asset, Camera, Incident, Role, Zone } from '@occ/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { relatedOfIncident } from '../../lib/assets/relatedItems';
import type { RelatedState } from '../../lib/incidents/useRelatedOfIncident';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { IncidentRelated } from './IncidentRelated';

const zone: Zone = {
  id: '6f1c2b1e-0000-4000-8000-000000000001',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: [108.44, 11.95],
};

const TOWER: Asset = {
  id: 'asset-ct-01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: zone.id,
  position: zone.center,
  elevationM: 1,
  headingDeg: 0,
  headline: [],
};

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'intrusion',
  severity: 'high',
  status: 'open',
  title: `Title of ${id}`,
  description: null,
  zoneId: zone.id,
  position: zone.center,
  source: 'operator',
  assetId: null,
  reportedAt: new Date(Date.now() - 14 * 60_000).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Offline, so a tile draws no stream and no canvas (jsdom has none). */
const camera = (code: string, name: string): Camera => ({
  id: code,
  code,
  name,
  zoneId: zone.id,
  position: [0, 0],
  online: false,
  fieldOfView: null,
});

/** The incident whose sheet it is: raised by a rule on the tower. */
const SELF = incident('self', { source: 'telemetry', assetId: TOWER.id });

const DOOR = camera('CAM-1', 'Library door');
const HALL = camera('CAM-2', 'Library hall');

/** What the hook hands the tab once the lists have arrived, built through the same seam. */
function ready(
  lists: { incidents?: Incident[]; assets?: Asset[]; cameras?: Camera[] } = {},
  subject: Incident = SELF,
): RelatedState {
  return {
    status: 'ready',
    related: relatedOfIncident(subject, {
      incidents: [subject, ...(lists.incidents ?? [])],
      assets: lists.assets ?? [],
      cameras: lists.cameras ?? [],
    }),
  };
}

const follows = (before: HTMLElement, after: HTMLElement) =>
  Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

function signInAs(role: Role) {
  useSession.getState().signedIn({ displayName: 'Signed-in user', roles: [role] });
}

function renderTab(state: RelatedState) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, [zone]);
  client.setQueryData(queryKeys.cameras, [DOOR, HALL]);
  return renderWithQueryClient(<IncidentRelated state={state} />, client);
}

// The incident sheet's Related tab (V3-09.5; frame 03a): reading only, for every role.
describe('IncidentRelated', () => {
  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    signInAs('operator');
  });

  describe('what it lists', () => {
    it('puts the incidents, the device and the cameras in that order, each headed with its count', () => {
      renderTab(
        ready({
          incidents: [incident('a'), incident('b')],
          assets: [TOWER],
          cameras: [DOOR, HALL],
        }),
      );

      const incidents = screen.getByRole('heading', { name: 'Incidents · 2' });
      const device = screen.getByRole('heading', { name: 'Device' });
      const cameras = screen.getByRole('heading', { name: 'Cameras covering it · 2' });
      expect(follows(incidents, device)).toBe(true);
      expect(follows(device, cameras)).toBe(true);
    });

    it('lists the other unresolved incidents of the zone as the feed does, and not the sheet’s own', () => {
      renderTab(
        ready({
          incidents: [
            incident('a'),
            incident('done', { status: 'resolved' }),
            incident('elsewhere', { zoneId: 'another-zone' }),
          ],
        }),
      );

      expect(screen.getByRole('button', { name: /Title of a/ })).toBeInTheDocument();
      expect(screen.queryByText('Title of done')).toBeNull();
      expect(screen.queryByText('Title of elsewhere')).toBeNull();
      expect(screen.queryByText('Title of self')).toBeNull();
    });

    it('names the device and where it stands', () => {
      renderTab(ready({ assets: [TOWER] }));

      expect(screen.getByText('CT-01 · Cooling tower 1')).toBeInTheDocument();
      expect(screen.getByText(/Library/)).toBeInTheDocument();
    });

    it('draws a tile for each camera that covers it', () => {
      renderTab(ready({ cameras: [DOOR, HALL] }));

      expect(screen.getByText('Library door')).toBeInTheDocument();
      expect(screen.getByText('Library hall')).toBeInTheDocument();
    });

    it('leaves out a section that has nothing in it', () => {
      renderTab(ready({ cameras: [DOOR] }));

      expect(screen.getByRole('heading', { name: 'Cameras covering it · 1' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /^Incidents/ })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Device' })).toBeNull();
    });

    it('draws no device for an incident the catalogue does not know', () => {
      renderTab(ready({ incidents: [incident('a')], assets: [] }));

      expect(screen.queryByRole('heading', { name: 'Device' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Open asset/ })).toBeNull();
    });

    it('says nothing else is related when the lists arrived and held nothing', () => {
      renderTab(ready());

      expect(screen.getByText('Nothing else is related to this incident.')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).toBeNull();
    });
  });

  describe('while the lists are not all there', () => {
    it('is a skeleton with a status, and does not claim there is nothing', () => {
      renderTab({ status: 'loading' });

      expect(screen.getByRole('status')).toHaveTextContent('Loading related items…');
      expect(screen.queryByText('Nothing else is related to this incident.')).toBeNull();
    });

    it('says the items could not be loaded, and does not claim there is nothing', () => {
      renderTab({ status: 'failed' });

      expect(screen.getByText('Related items could not be loaded.')).toBeInTheDocument();
      expect(screen.queryByText('Nothing else is related to this incident.')).toBeNull();
    });
  });

  describe('choosing an item', () => {
    it('selects the incident of the row, which replaces this one', async () => {
      useConsole.setState({ selectedIncidentId: SELF.id });
      renderTab(ready({ incidents: [incident('a')] }));

      await userEvent.click(screen.getByRole('button', { name: /Title of a/ }));

      expect(useConsole.getState().selectedIncidentId).toBe('a');
    });

    it('opens the device in the asset inspector, in place of the incident', async () => {
      useConsole.setState({ selectedIncidentId: SELF.id });
      renderTab(ready({ assets: [TOWER] }));

      await userEvent.click(screen.getByRole('button', { name: 'Open asset CT-01' }));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('offers “Open asset” and nothing else for the device', () => {
      renderTab(ready({ assets: [TOWER] }));

      const device = screen.getByText('CT-01 · Cooling tower 1').closest('div')!;
      expect(within(device).getAllByRole('button')).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /Show in 3D/ })).toBeNull();
    });

    // Reading is not an action on the site: no role is asked for anything here.
    it.each<Role>(['operator', 'supervisor', 'technician', 'viewer'])(
      'lets a %s open an incident and the device',
      async (role) => {
        resetStore(useSession);
        signInAs(role);
        renderTab(ready({ incidents: [incident('a')], assets: [TOWER] }));

        await userEvent.click(screen.getByRole('button', { name: 'Open asset CT-01' }));
        expect(useConsole.getState().selectedAssetCode).toBe('CT-01');

        await userEvent.click(screen.getByRole('button', { name: /Title of a/ }));
        expect(useConsole.getState().selectedIncidentId).toBe('a');
      },
    );
  });

  describe('accessibility', () => {
    it('has no axe violations with everything listed', async () => {
      const { container } = renderTab(
        ready({ incidents: [incident('a')], assets: [TOWER], cameras: [DOOR, HALL] }),
      );

      await expectNoAxeViolations(container);
    });

    it('has no axe violations when nothing is related', async () => {
      const { container } = renderTab(ready());

      await expectNoAxeViolations(container);
    });

    it('has no axe violations while loading, and when it could not load', async () => {
      const loading = renderTab({ status: 'loading' });
      await expectNoAxeViolations(loading.container);
      loading.unmount();

      const failed = renderTab({ status: 'failed' });
      await expectNoAxeViolations(failed.container);
    });
  });
});

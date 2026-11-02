import type { Asset, Camera, Incident, LngLat, Role, Zone } from '@occ/contracts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { useSession } from '../../auth/store';
import { relatedOfAsset } from '../../lib/assets/relatedItems';
import type { AssetRelatedState } from '../../lib/assets/useRelatedOfAsset';
import { offsetM } from '../../lib/map/geo';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { AssetRelated } from './AssetRelated';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const POSITION: LngLat = [108.44, 11.95];
const NOW = Date.parse('2026-10-15T08:00:00.000Z');

const zone: Zone = {
  id: '6f1c2b1e-0000-4000-8000-000000000001',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  polygon: [],
  center: POSITION,
};

const asset = (code: string, name: string, overrides: Partial<Asset> = {}): Asset => ({
  id: `asset-${code.toLowerCase()}`,
  code,
  name,
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: zone.id,
  position: POSITION,
  elevationM: 0,
  headingDeg: 0,
  headline: [],
  ...overrides,
});

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: `Title of ${id}`,
  description: null,
  zoneId: zone.id,
  position: POSITION,
  source: 'telemetry',
  assetId: null,
  reportedAt: new Date(Date.now() - 14 * 60_000).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Offline and facing the asset, so a tile draws no stream or canvas (jsdom has none) yet "sees" it. */
const seeing = (code: string, name: string): Camera => ({
  id: code,
  code,
  name,
  zoneId: zone.id,
  position: offsetM(POSITION, 0, -20),
  online: false,
  fieldOfView: { heading: 0, angle: 90, range: 50 },
});

const SELF = asset('CT-01', 'Cooling tower 1');
const BESIDE = asset('CT-02', 'Cooling tower 2');
const PUMP = asset('PMP-01', 'Chilled water pump');
const DOOR = seeing('CAM-1', 'Data hall door');
const HALL = seeing('CAM-2', 'Data hall aisle');

interface Lists {
  incidents?: Incident[];
  assets?: Asset[];
  cameras?: Camera[];
}

/** What the hook hands the tab once the lists have arrived, built through the same seam. */
function ready({ incidents = [], assets = [], cameras = [] }: Lists = {}): AssetRelatedState {
  return {
    status: 'ready',
    related: relatedOfAsset(SELF, { incidents, assets: [SELF, ...assets], cameras }),
  };
}

const follows = (before: HTMLElement, after: HTMLElement) =>
  Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

function signInAs(role: Role) {
  useSession.getState().signedIn({ displayName: 'Signed-in user', roles: [role] });
}

/** What the console holds of one sibling: received now, on the API's clock. */
const entry = (values: AssetTelemetryState['values'] = {}, online = true): AssetTelemetryState => ({
  online,
  receivedAt: new Date(NOW).toISOString(),
  headline: {},
  values,
  keyReceivedAt: {},
});

function hold(assets: Record<string, AssetTelemetryState>) {
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at: NOW, mono: performance.now() },
          assets,
        },
        series: new Map(),
      },
    }),
  );
}

/** `zones: null` leaves the zone list unloaded (the building focus is then not known). */
function renderTab(
  state: AssetRelatedState,
  { incidents = [], zones = [zone] }: { incidents?: Incident[]; zones?: Zone[] | null } = {},
) {
  const client = createTestQueryClient();
  if (zones) client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.cameras, [DOOR, HALL]);
  return renderWithQueryClient(<AssetRelated state={state} />, client);
}

// The asset sheet's Related tab (V3-09.8): reading only, for every role.
describe('AssetRelated', () => {
  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    resetStore(useTelemetryStore);
    signInAs('operator');
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    // Whatever the case did not seed never settles.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('what it lists', () => {
    it('puts the incidents, the cameras and the assets in that order, each headed with its count', () => {
      renderTab(
        ready({
          incidents: [incident('a', { assetId: SELF.id }), incident('b', { assetId: SELF.id })],
          assets: [BESIDE, PUMP],
          cameras: [DOOR, HALL],
        }),
      );

      const incidents = screen.getByRole('heading', { name: 'Incidents · 2' });
      const cameras = screen.getByRole('heading', { name: 'Cameras covering it · 2' });
      const assets = screen.getByRole('heading', { name: 'Assets in this zone · 2' });
      expect(follows(incidents, cameras)).toBe(true);
      expect(follows(cameras, assets)).toBe(true);
    });

    it('lists the asset’s unresolved incidents as the feed does, and not another asset’s', () => {
      renderTab(
        ready({
          incidents: [
            incident('a', { assetId: SELF.id }),
            incident('done', { assetId: SELF.id, status: 'resolved' }),
            incident('theirs', { assetId: BESIDE.id }),
          ],
        }),
      );

      expect(screen.getByRole('button', { name: /Title of a/ })).toBeInTheDocument();
      expect(screen.queryByText('Title of done')).toBeNull();
      expect(screen.queryByText('Title of theirs')).toBeNull();
    });

    it('draws a tile for each camera that sees it', () => {
      renderTab(ready({ cameras: [DOOR, HALL] }));

      expect(screen.getByText('Data hall door')).toBeInTheDocument();
      expect(screen.getByText('Data hall aisle')).toBeInTheDocument();
    });

    it('lists the other assets of the zone by code, and not the asset itself', () => {
      renderTab(ready({ assets: [PUMP, BESIDE] }));

      const rows = within(
        screen.getByRole('heading', { name: /^Assets in this zone/ }).closest('section')!,
      )
        .getAllByRole('button')
        .map((row) => row.textContent);
      expect(rows[0]).toContain('CT-02');
      expect(rows[1]).toContain('PMP-01');
      expect(rows).toHaveLength(2);
    });

    it('leaves out a section that has nothing in it', () => {
      renderTab(ready({ cameras: [DOOR] }));

      expect(screen.getByRole('heading', { name: 'Cameras covering it · 1' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /^Incidents/ })).toBeNull();
      expect(screen.queryByRole('heading', { name: /^Assets in this zone/ })).toBeNull();
    });

    it('says nothing else is related when the lists arrived and held nothing', () => {
      renderTab(ready());

      expect(screen.getByText('Nothing else is related to this asset.')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).toBeNull();
    });
  });

  describe('while the lists are not all there', () => {
    it('is a skeleton with a status, and does not claim there is nothing', () => {
      renderTab({ status: 'loading' });

      expect(screen.getByRole('status')).toHaveTextContent('Loading related items…');
      expect(screen.queryByText('Nothing else is related to this asset.')).toBeNull();
    });

    it('says the items could not be loaded, and does not claim there is nothing', () => {
      renderTab({ status: 'failed' });

      expect(screen.getByText('Related items could not be loaded.')).toBeInTheDocument();
      expect(screen.queryByText('Nothing else is related to this asset.')).toBeNull();
    });
  });

  describe('a sibling asset', () => {
    it('shows its name, its code and the state word of its own reading', () => {
      hold({ 'CT-02': entry({ running: true }) });
      renderTab(ready({ assets: [BESIDE] }));

      const row = screen.getByRole('button', { name: /Cooling tower 2/ });
      expect(within(row).getByText('Running')).toBeInTheDocument();
      expect(within(row).getByText('CT-02')).toBeInTheDocument();
    });

    it.each([
      ['standby', { running: false }, 'Standby'],
      ['running', { running: true }, 'Running'],
    ])('says %s for a device that is', (_name, values, word) => {
      hold({ 'CT-02': entry(values) });
      renderTab(ready({ assets: [BESIDE] }));

      expect(
        within(screen.getByRole('button', { name: /Cooling tower 2/ })).getByText(word),
      ).toBeInTheDocument();
    });

    it('says no data for a device nothing was received from, and offline for one that is', () => {
      hold({ 'CT-02': entry({}, false) });
      renderTab(ready({ assets: [BESIDE, PUMP] }));

      expect(
        within(screen.getByRole('button', { name: /Cooling tower 2/ })).getByText(/^Offline since/),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('button', { name: /Chilled water pump/ })).getByText('No data'),
      ).toBeInTheDocument();
    });

    it('says fault, with the incident’s severity in the name, for an asset with an open incident', () => {
      hold({ 'CT-02': entry({ running: true }) });
      const raised = incident('f', { assetId: BESIDE.id, severity: 'critical' });
      renderTab(ready({ assets: [BESIDE], incidents: [raised] }), { incidents: [raised] });

      expect(
        screen.getByRole('button', { name: /Cooling tower 2.*Critical severity,\s*Fault/ }),
      ).toBeInTheDocument();
    });

    it('does not say the asset is running when its state point has no value', () => {
      hold({ 'CT-02': entry({ fanSpeedRpm: 0 }) });
      renderTab(ready({ assets: [BESIDE] }));

      const row = screen.getByRole('button', { name: /Cooling tower 2/ });
      expect(within(row).queryByText(/Running|Standby|Fault|No data|Offline/)).toBeNull();
    });

    it('follows its own reading as it arrives', () => {
      hold({ 'CT-02': entry({ running: true }) });
      renderTab(ready({ assets: [BESIDE] }));
      const row = screen.getByRole('button', { name: /Cooling tower 2/ });
      expect(within(row).getByText('Running')).toBeInTheDocument();

      hold({ 'CT-02': entry({ running: false }) });

      expect(within(row).getByText('Standby')).toBeInTheDocument();
    });

    it('is not drawn again for the reading of an asset that is not in the tab', () => {
      hold({ 'CT-02': entry({ running: true }) });
      const onRender = vi.fn();
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.zones, [zone]);
      client.setQueryData(queryKeys.incidents, []);
      client.setQueryData(queryKeys.cameras, []);
      renderWithQueryClient(
        <Profiler id="related" onRender={onRender}>
          <AssetRelated state={ready({ assets: [BESIDE] })} />
        </Profiler>,
        client,
      );
      const before = onRender.mock.calls.length;

      // Another asset's frame: the sibling's entry and the clock are the same references.
      act(() =>
        useTelemetryStore.setState((state) => ({
          view: {
            ...state.view,
            state: {
              ...state.view.state,
              assets: { ...state.view.state.assets, 'CT-99': entry({ running: false }) },
            },
          },
        })),
      );

      expect(onRender.mock.calls.length).toBe(before);
    });
  });

  describe('choosing an item', () => {
    it('selects the incident of the row, which replaces the asset', async () => {
      useConsole.getState().selectAsset('CT-01', zone.id);
      renderTab(ready({ incidents: [incident('a', { assetId: SELF.id })] }));

      await userEvent.click(screen.getByRole('button', { name: /Title of a/ }));

      expect(useConsole.getState().selectedIncidentId).toBe('a');
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    it('opens a sibling in place of the asset, with the focus of its building', async () => {
      useConsole.getState().selectAsset('CT-01', null);
      renderTab(ready({ assets: [BESIDE] }));

      await userEvent.click(screen.getByRole('button', { name: /Cooling tower 2/ }));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-02');
      expect(useConsole.getState().selectedIncidentId).toBeNull();
      expect(useConsole.getState().focusZoneId).toBe(zone.id);
    });

    it('opens a sibling without a building focus while the zones are not known', async () => {
      useConsole.getState().selectAsset('CT-01', null);
      renderTab(ready({ assets: [BESIDE] }), { zones: null });

      await userEvent.click(screen.getByRole('button', { name: /Cooling tower 2/ }));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-02');
      expect(useConsole.getState().focusZoneId).toBeNull();
    });

    it('does not deselect when the sibling is the asset already selected', async () => {
      useConsole.getState().selectAsset('CT-02', null);
      renderTab(ready({ assets: [BESIDE] }));

      await userEvent.click(screen.getByRole('button', { name: /Cooling tower 2/ }));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-02');
    });
  });

  describe('roles', () => {
    it.each<Role>(['viewer', 'technician', 'supervisor'])(
      'lists and opens a sibling as a %s: nothing here is an action on the site',
      async (role) => {
        signInAs(role);
        renderTab(ready({ assets: [BESIDE], incidents: [incident('a', { assetId: SELF.id })] }));

        await userEvent.click(screen.getByRole('button', { name: /Cooling tower 2/ }));

        expect(useConsole.getState().selectedAssetCode).toBe('CT-02');
      },
    );
  });

  describe('accessibility', () => {
    it('has no axe violations with every section', async () => {
      hold({ 'CT-02': entry({ running: true }) });
      const raised = incident('a', { assetId: SELF.id });
      renderTab(ready({ incidents: [raised], assets: [BESIDE, PUMP], cameras: [DOOR] }), {
        incidents: [raised],
      });

      await expectNoAxeViolations();
    });

    it('has no axe violations when empty', async () => {
      renderTab(ready());

      await expectNoAxeViolations();
    });

    it('has no axe violations while loading', async () => {
      renderTab({ status: 'loading' });

      await expectNoAxeViolations();
    });
  });
});

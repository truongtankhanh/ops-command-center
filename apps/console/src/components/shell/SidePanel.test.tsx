import type { Asset, Incident, Zone } from '@occ/contracts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement } from 'react';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { useConsole } from '../../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../../test-utils';
import { IncidentFeed } from '../incidents/IncidentFeed';
import { SidePanel } from './SidePanel';

// No token in these cases; the API client only asks for one.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const zone: Zone = {
  id: 'z1',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: [0, 0],
};

const incident = (id: string, status: Incident['status'], title: string): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'intrusion',
  title,
  description: null,
  zoneId: 'z1',
  position: [0, 0],
  source: 'operator',
  status,
  severity: 'high',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
});

// Two active (open, acknowledged), one resolved: the switch counts the active ones.
const incidents: Incident[] = [
  incident('a', 'open', 'Door forced open'),
  incident('b', 'acknowledged', 'Queue at gate'),
  incident('c', 'resolved', 'Smoke detector'),
];

const assets = Array.from({ length: 4 }, (_, i) => ({
  id: `asset-${i}`,
  code: `CT-0${i}`,
})) as Asset[];

const fetchMock = vi.fn<typeof fetch>();

function render(ui: ReactElement, { seedAssets = true, seedIncidents = true } = {}) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, [zone]);
  if (seedIncidents) client.setQueryData(queryKeys.incidents, incidents);
  if (seedAssets) client.setQueryData(queryKeys.assets, assets);
  return renderWithQueryClient(ui, client);
}

const stubs = (
  <SidePanel
    incidents={<button type="button">Incident slot</button>}
    assets={<button type="button">Asset slot</button>}
  />
);

const tab = (name: string | RegExp) => screen.getByRole('tab', { name });

/**
 * The panel a tab controls, found by id: a hidden element has no accessible name of its own, so a
 * hidden panel cannot be asked for by `name` even though `aria-labelledby` is right.
 */
const panelOf = (name: string | RegExp): HTMLElement => {
  const panel = document.getElementById(tab(name).getAttribute('aria-controls') ?? '');
  if (!panel) throw new Error(`No panel is controlled by the tab ${String(name)}`);
  return panel;
};

describe('SidePanel', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    // Every query is seeded or left pending; nothing leaves the test.
    fetchMock.mockReset().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('the switch', () => {
    it('is the incidents and assets landmark, with a named two-tab list', () => {
      render(stubs);

      expect(
        screen.getByRole('complementary', { name: 'Incidents and assets' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('tablist', { name: 'Side panel' })).toBeInTheDocument();
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    it('starts on the incidents', () => {
      render(stubs);

      expect(tab('Incidents 2')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Assets 4')).toHaveAttribute('aria-selected', 'false');
    });

    it('counts the active incidents and the catalogue, in the tab names', () => {
      render(stubs);

      expect(tab('Incidents 2')).toBeInTheDocument();
      expect(tab('Assets 4')).toBeInTheDocument();
    });

    it('leaves a count out while its list is not known', () => {
      render(stubs, { seedAssets: false, seedIncidents: false });

      expect(tab('Incidents')).toBeInTheDocument();
      expect(tab('Assets')).toBeInTheDocument();
    });

    it('shows 0 for an empty catalogue, which is a known count', () => {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.incidents, []);
      client.setQueryData(queryKeys.assets, []);
      renderWithQueryClient(stubs, client);

      expect(tab('Incidents 0')).toBeInTheDocument();
      expect(tab('Assets 0')).toBeInTheDocument();
    });

    it('is a single Tab stop, on the selected tab', () => {
      render(stubs);

      expect(tab('Incidents 2')).toHaveAttribute('tabindex', '0');
      expect(tab('Assets 4')).toHaveAttribute('tabindex', '-1');
    });
  });

  describe('selecting a panel', () => {
    it('switches on click and records it in the store', async () => {
      render(stubs);

      await userEvent.click(tab('Assets 4'));

      expect(useConsole.getState().sidePanel).toBe('assets');
      expect(tab('Assets 4')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Assets 4')).toHaveAttribute('tabindex', '0');
      expect(tab('Incidents 2')).toHaveAttribute('tabindex', '-1');
    });

    it('moves and selects with the arrows, wrapping around', async () => {
      render(stubs);
      act(() => tab('Incidents 2').focus());

      await userEvent.keyboard('{ArrowRight}');
      expect(tab('Assets 4')).toHaveFocus();
      expect(useConsole.getState().sidePanel).toBe('assets');

      await userEvent.keyboard('{ArrowRight}');
      expect(tab('Incidents 2')).toHaveFocus();
      expect(useConsole.getState().sidePanel).toBe('incidents');

      await userEvent.keyboard('{ArrowLeft}');
      expect(tab('Assets 4')).toHaveFocus();
    });

    it('jumps to the ends with Home and End', async () => {
      render(stubs);
      act(() => tab('Incidents 2').focus());

      await userEvent.keyboard('{End}');
      expect(useConsole.getState().sidePanel).toBe('assets');
      expect(tab('Assets 4')).toHaveFocus();

      await userEvent.keyboard('{Home}');
      expect(useConsole.getState().sidePanel).toBe('incidents');
      expect(tab('Incidents 2')).toHaveFocus();
    });

    it('follows a change of panel made elsewhere in the store', () => {
      render(stubs);

      // What a KPI tile does with the assets showing (`toggleSeverity`).
      act(() => useConsole.getState().setSidePanel('assets'));

      expect(tab('Assets 4')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('button', { name: 'Asset slot' })).toBeVisible();
    });
  });

  describe('the panels', () => {
    it('keeps both mounted and hides only the inactive one', () => {
      render(stubs);

      const incidentsPanel = panelOf('Incidents 2');
      const assetsPanel = panelOf('Assets 4');
      expect(incidentsPanel).not.toHaveAttribute('hidden');
      expect(assetsPanel).toHaveAttribute('hidden');
      expect(
        within(assetsPanel).getByRole('button', { name: 'Asset slot', hidden: true }),
      ).toBeInTheDocument();
    });

    it('swaps which panel is hidden on a switch, without remounting either', async () => {
      render(stubs);
      const assetSlot = screen.getByRole('button', { name: 'Asset slot', hidden: true });

      await userEvent.click(tab('Assets 4'));

      expect(panelOf('Assets 4')).not.toHaveAttribute('hidden');
      expect(panelOf('Incidents 2')).toHaveAttribute('hidden');
      // The visible panel is the one assistive tech finds, named by its tab.
      expect(screen.getByRole('tabpanel', { name: 'Assets 4' })).toBe(panelOf('Assets 4'));
      expect(screen.getByRole('button', { name: 'Asset slot' })).toBe(assetSlot);
    });

    it('wires each tab to its panel, and each panel to its tab', () => {
      render(stubs);

      for (const name of ['Incidents 2', 'Assets 4']) {
        const controlled = document.getElementById(tab(name).getAttribute('aria-controls') ?? '');
        expect(controlled).toHaveAttribute('role', 'tabpanel');
        expect(controlled).toHaveAttribute('aria-labelledby', tab(name).id);
      }
    });

    it('keeps the incident feed as it was: search text and the selected incident', async () => {
      render(
        <SidePanel
          incidents={<IncidentFeed />}
          assets={<button type="button">Asset slot</button>}
        />,
      );
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search incidents' }), 'door');
      await userEvent.click(screen.getByRole('button', { name: /Door forced open/ }));

      await userEvent.click(tab(/^Assets/));
      await userEvent.click(tab(/^Incidents/));

      expect(screen.getByRole('searchbox', { name: 'Search incidents' })).toHaveValue('door');
      expect(useConsole.getState().selectedIncidentId).toBe('a');
      expect(screen.getByRole('button', { name: /Door forced open/ })).toHaveAttribute(
        'aria-current',
        'true',
      );
    });
  });
});

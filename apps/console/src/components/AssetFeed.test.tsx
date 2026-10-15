import type { Asset, Incident, TelemetryPoint, Zone } from '@occ/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  queryRetryDelay,
  RATE_LIMITED_RETRYING,
  shouldRetryQuery,
  TOO_MANY_REQUESTS,
} from '../api/client';
import { queryKeys } from '../api/queries';
import { useSession } from '../auth/store';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { AssetFeed } from './AssetFeed';

// No token in these cases; the API client only asks for one.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const point: TelemetryPoint = {
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
};

const asset = (overrides: Partial<Asset>): Asset => ({
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
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 14,
  headingDeg: 0,
  headline: [point],
  ...overrides,
});

const zones: Zone[] = [
  {
    id: 'zone-dc',
    code: 'BLD-DC',
    name: 'Data Center',
    kind: 'building',
    polygon: [],
    center: [0, 0],
  },
  {
    id: 'zone-lib',
    code: 'BLD-LIB',
    name: 'Library',
    kind: 'building',
    polygon: [],
    center: [0, 0],
  },
];

const assets: Asset[] = [
  asset({}),
  asset({ id: 'asset-ct-02', code: 'CT-02', name: 'Cooling tower 2' }),
  asset({ id: 'asset-lks-b3', code: 'LKS-B3', name: 'Leak sensor B3', zoneId: 'zone-lib' }),
];

// CT-01 raised this one: a fault. Nothing is in the telemetry overview, so the other two have no data.
const incidents: Incident[] = [
  {
    id: 'inc-1',
    code: 'INC-000001',
    type: 'equipment_fault',
    severity: 'high',
    status: 'open',
    title: 'Fan fault',
    description: null,
    zoneId: 'zone-dc',
    position: [0, 0],
    source: 'telemetry',
    assetId: 'asset-ct-01',
    reportedAt: new Date().toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
  },
];

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A cache with the catalogue, the incidents and the zones; no request is needed. */
function seeded(list: Asset[] = assets): QueryClient {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, list);
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.zones, zones);
  return client;
}

/** A cache with no catalogue: the feed asks the API for it (`fetchMock`). */
function unseeded(client = createTestQueryClient()): QueryClient {
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.zones, zones);
  return client;
}

const searchbox = () => screen.getByRole('searchbox', { name: 'Search assets' });

describe('AssetFeed', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    resetStore(useTelemetryStore);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    fetchMock.mockReset().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('the shell', () => {
    it('names the section, the search and the filter tabs after frame 03', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('region', { name: 'Assets' })).toBeInTheDocument();
      expect(searchbox()).toHaveAttribute('placeholder', 'Search asset, code or zone');
      expect(screen.getByRole('tablist', { name: 'Filter assets' })).toBeInTheDocument();
    });

    it('counts each filter tab, in the tab name', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('tab', { name: 'All 3' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Faults 1' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
      expect(screen.getByRole('tab', { name: 'No data 2' })).toBeInTheDocument();
    });

    it('draws nothing under the tabs for a catalogue that has assets, and no empty list', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.queryByRole('list')).toBeNull();
      expect(screen.queryByText('No assets are set up on this site.')).toBeNull();
    });

    it('selects a filter tab in the store', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(screen.getByRole('tab', { name: 'Faults 1' }));

      expect(useConsole.getState().assetFilter).toBe('faults');
      expect(screen.getByRole('tab', { name: 'Faults 1' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('shows the same console to a viewer', () => {
      useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] });

      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('tab', { name: 'All 3' })).toBeInTheDocument();
    });
  });

  describe('search and zone', () => {
    it('narrows every count by the search, matching name, code and zone', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.type(searchbox(), 'leak');

      expect(screen.getByRole('tab', { name: 'All 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Faults 0' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'No data 1' })).toBeInTheDocument();
      expect(screen.getByText('1 asset matches')).toBeInTheDocument();
    });

    it('matches the zone name, folded for case', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.type(searchbox(), 'DATA center');

      expect(screen.getByRole('tab', { name: 'All 2' })).toBeInTheDocument();
      expect(screen.getByText('2 assets match')).toBeInTheDocument();
    });

    it('narrows every count by the chosen zone', () => {
      useConsole.setState({ assetZoneId: 'zone-lib' });

      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('tab', { name: 'All 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Faults 0' })).toBeInTheDocument();
    });
  });

  describe('loading and errors', () => {
    it('shows placeholder rows while the catalogue loads, and no counts', () => {
      renderWithQueryClient(<AssetFeed />, unseeded());

      const loading = screen.getByText('Loading assets…');
      expect(loading).toHaveAttribute('role', 'status');
      expect(loading.parentElement).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    });

    it('says the catalogue could not be loaded, and retries', async () => {
      fetchMock
        .mockImplementationOnce(async () => json({ statusCode: 500, message: 'Internal' }, 500))
        .mockImplementationOnce(async () => json(assets));
      renderWithQueryClient(<AssetFeed />, unseeded());

      expect(await screen.findByText('Assets could not be loaded.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('tab', { name: 'All 3' })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('waits calmly while too many requests are retried', async () => {
      // The console's own policy: a 429 is retried after 2 s, which this case never waits for.
      const client = new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
      });
      fetchMock.mockImplementationOnce(async () =>
        json({ statusCode: 429, message: 'Too many requests' }, 429),
      );
      const { unmount } = renderWithQueryClient(<AssetFeed />, unseeded(client));

      const retrying = await screen.findByText(RATE_LIMITED_RETRYING);
      expect(retrying.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

      unmount();
      await client.cancelQueries();
    });

    it('explains too many requests once the retries are over', async () => {
      fetchMock.mockImplementationOnce(async () =>
        json({ statusCode: 429, message: 'Too many requests' }, 429),
      );
      renderWithQueryClient(<AssetFeed />, unseeded());

      expect(await screen.findByText(TOO_MANY_REQUESTS)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('says no assets are set up for an empty catalogue', () => {
      renderWithQueryClient(<AssetFeed />, seeded([]));

      expect(screen.getByText('No assets are set up on this site.')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'All 0' })).toBeInTheDocument();
    });

    // An API from before V2-05 has no route (ADR-0018 § Rolling deploys): "no assets", not an error.
    it('reads a 404 as an empty catalogue', async () => {
      fetchMock.mockImplementationOnce(async () =>
        json({ statusCode: 404, message: 'Not Found' }, 404),
      );
      renderWithQueryClient(<AssetFeed />, unseeded());

      expect(await screen.findByText('No assets are set up on this site.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
  });

  describe('the / shortcut', () => {
    it('focuses the search while the assets are the visible panel', async () => {
      useConsole.setState({ sidePanel: 'assets' });
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.keyboard('/');

      expect(searchbox()).toHaveFocus();
    });

    it('leaves the key to the incident feed while the incidents are visible', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.keyboard('/');

      expect(searchbox()).not.toHaveFocus();
    });

    it('follows a change of panel', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());
      act(() => useConsole.getState().setSidePanel('assets'));

      await userEvent.keyboard('/');

      expect(searchbox()).toHaveFocus();
    });
  });
});

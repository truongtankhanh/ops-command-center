import type { Asset, Camera, Incident, StreamDescriptor, Zone } from '@occ/contracts';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryRetryDelay, RATE_LIMITED_RETRYING, shouldRetryQuery } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { offsetM } from '../../lib/map/geo';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubViewportWidth,
} from '../../test-utils';
import { CameraStrip } from './CameraStrip';

// No token in these cases; the API client only asks for one.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

/** Offline by default: no stream request and no canvas, so a case tests the strip, not the tile. */
const camera = (overrides: Partial<Camera> = {}): Camera => ({
  id: 'c1',
  code: 'CAM-L01',
  name: 'Library entrance',
  zoneId: 'z1',
  position: [108.44, 11.95],
  online: false,
  fieldOfView: null,
  ...overrides,
});

/** `n` offline cameras, `c1` … `cn`, named `Camera 1` … `Camera n`. */
const manyCameras = (n: number): Camera[] =>
  Array.from({ length: n }, (_, i) =>
    camera({ id: `c${i + 1}`, code: `CAM-${i + 1}`, name: `Camera ${i + 1}` }),
  );

const zones: Zone[] = [
  {
    id: 'z1',
    code: 'BLD-LIB',
    name: 'Library',
    kind: 'building',
    polygon: [],
    center: [108.44, 11.95],
  },
  {
    id: 'z2',
    code: 'GATE-N',
    name: 'North gate',
    kind: 'gate',
    polygon: [],
    center: [108.45, 11.96],
  },
];

const incidentInLibrary: Incident = {
  id: 'i1',
  code: 'INC-000001',
  type: 'intrusion',
  title: 'Door forced open',
  description: null,
  severity: 'high',
  status: 'open',
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

const fetchMock = vi.fn<typeof fetch>();
/** What the next `GET /cameras` answer, one factory each; once empty, a request stays pending. */
let camerasAnswers: (() => Response)[] = [];

/** A body can be read only once, so build one per call. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiError(status: number, message: string): Response {
  return json({ statusCode: status, message }, status);
}

const cameraRequests = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/cameras'));

/** Zones and incidents cached; the camera list too, unless `null` (then the strip asks for it). */
function renderStrip({
  cameras = [camera()] as Camera[] | null,
  incidents = [] as Incident[],
  assets = null as Asset[] | null,
  client = createTestQueryClient(),
}: {
  cameras?: Camera[] | null;
  incidents?: Incident[];
  assets?: Asset[] | null;
  client?: QueryClient;
} = {}) {
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.incidents, incidents);
  if (cameras) client.setQueryData(queryKeys.cameras, cameras);
  // Unseeded, `GET /assets` stays pending in the `fetch` stub: no asset is known.
  if (assets) client.setQueryData(queryKeys.assets, assets);
  return renderWithQueryClient(<CameraStrip />, client);
}

const strip = () => screen.getByRole('region', { name: 'Cameras' });

describe('CameraStrip', () => {
  beforeEach(() => {
    resetStore(useConsole);
    camerasAnswers = [];
    fetchMock.mockReset().mockImplementation((input) => {
      const answer = String(input).endsWith('/cameras') ? camerasAnswers.shift() : undefined;
      return answer ? Promise.resolve(answer()) : new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows a tile per camera', () => {
    renderStrip({
      cameras: [camera(), camera({ id: 'c2', code: 'CAM-G01', name: 'Gate kiosk', zoneId: 'z2' })],
    });

    expect(screen.getByText('Library entrance')).toBeInTheDocument();
    expect(screen.getByText('Gate kiosk')).toBeInTheDocument();
    expect(screen.getAllByText('No signal')).toHaveLength(2);
    expect(strip()).not.toHaveAttribute('aria-busy');
  });

  it("marks the cameras in the selected incident's zone", () => {
    useConsole.setState({ selectedIncidentId: incidentInLibrary.id });

    renderStrip({
      cameras: [camera(), camera({ id: 'c2', code: 'CAM-G01', name: 'Gate kiosk', zoneId: 'z2' })],
      incidents: [incidentInLibrary],
    });

    expect(screen.getAllByText('In zone')).toHaveLength(1);
  });

  describe('with an asset selected', () => {
    const POSITION: [number, number] = [108.44, 11.95];
    const asset = {
      id: 'a1',
      code: 'CT-01',
      name: 'Cooling tower 1',
      class: {
        id: 'k1',
        code: 'cooling_tower',
        name: 'Cooling tower',
        modelUrl: null,
        footprintM: { width: 4, depth: 4, height: 5 },
      },
      zoneId: 'z1',
      position: POSITION,
      elevationM: 14,
      headingDeg: 0,
      headline: [],
    } satisfies Asset;

    /** In the library zone, with no view; in the gate zone and looking at the asset; elsewhere. */
    const cameras = [
      camera({ id: 'c1', code: 'CAM-L01', name: 'Library entrance', zoneId: 'z1' }),
      camera({
        id: 'c2',
        code: 'CAM-G01',
        name: 'Gate kiosk',
        zoneId: 'z2',
        position: offsetM(POSITION, 0, -20),
        fieldOfView: { heading: 0, angle: 90, range: 50 },
      }),
      camera({ id: 'c3', code: 'CAM-X01', name: 'Yard', zoneId: 'z3' }),
    ];

    const names = () =>
      within(strip())
        .getAllByRole('figure')
        .map((tile) => tile.querySelector('figcaption')?.textContent ?? '');

    it('puts the cameras that see it first, then its zone, and says which each is', () => {
      useConsole.setState({ selectedAssetCode: 'CT-01' });

      renderStrip({ cameras, assets: [asset] });

      const order = names();
      expect(order[0]).toContain('Gate kiosk');
      expect(order[1]).toContain('Library entrance');
      expect(order[2]).toContain('Yard');
      expect(screen.getAllByText('On this asset')).toHaveLength(1);
      expect(screen.getAllByText('In zone')).toHaveLength(1);
    });

    it('keeps a pinned camera ahead of the cameras that see it', () => {
      useConsole.setState({ selectedAssetCode: 'CT-01', pinnedCameraIds: ['c3'] });

      renderStrip({ cameras, assets: [asset] });

      const order = names();
      expect(order[0]).toContain('Yard');
      expect(order[1]).toContain('Gate kiosk');
    });

    it('orders as with nothing selected while the asset list is not loaded', () => {
      useConsole.setState({ selectedAssetCode: 'CT-01' });

      renderStrip({ cameras });

      expect(screen.queryByText('On this asset')).toBeNull();
      expect(screen.queryByText('In zone')).toBeNull();
      // By code: CAM-G01, CAM-L01, CAM-X01.
      const order = names();
      expect(order[0]).toContain('Gate kiosk');
      expect(order[1]).toContain('Library entrance');
    });

    it('says nothing for an asset the list does not have', () => {
      useConsole.setState({ selectedAssetCode: 'GONE-01' });

      renderStrip({ cameras, assets: [asset] });

      expect(screen.queryByText('On this asset')).toBeNull();
      expect(screen.queryByText('In zone')).toBeNull();
    });

    it('leaves an incident selection as it was', () => {
      useConsole.setState({ selectedIncidentId: incidentInLibrary.id });

      renderStrip({ cameras, incidents: [incidentInLibrary], assets: [asset] });

      expect(screen.queryByText('On this asset')).toBeNull();
      expect(screen.getAllByText('In zone')).toHaveLength(1);
      expect(names()[0]).toContain('Library entrance');
    });
  });

  it('holds its place while the cameras load', () => {
    renderStrip({ cameras: null });

    expect(screen.getByText('Loading cameras…')).toHaveAttribute('role', 'status');
    expect(strip()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No signal')).toBeNull();
  });

  it('says the cameras could not be loaded, and retries', async () => {
    camerasAnswers = [() => apiError(500, 'Internal server error'), () => json([camera()])];
    renderStrip({ cameras: null });

    expect(await screen.findByText('Cameras could not be loaded.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Library entrance')).toBeInTheDocument();
    await waitFor(() => expect(cameraRequests()).toHaveLength(2));
  });

  it('waits calmly while too many requests are retried', async () => {
    // The console's own policy: a 429 is retried after 2 s, which this case never waits for.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
    });
    camerasAnswers = [() => apiError(429, 'Too many requests')];
    const { unmount } = renderStrip({ cameras: null, client });

    const retrying = await screen.findByText(RATE_LIMITED_RETRYING);
    expect(retrying.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(strip()).not.toHaveAttribute('aria-busy');

    unmount();
    await client.cancelQueries();
  });

  it('says so when the site has no camera', () => {
    renderStrip({ cameras: [] });

    expect(screen.getByText('No cameras are set up on this site.')).toBeInTheDocument();
  });

  // The tile count follows the display mode (`stripSize`); without `matchMedia` it is a laptop's 4.
  describe('on a control-room wall', () => {
    const tileNames = () => screen.getAllByText(/^Camera \d+$/).map((name) => name.textContent);

    it('shows six tiles on a wall display', () => {
      stubViewportWidth(1920);

      renderStrip({ cameras: manyCameras(10) });

      expect(screen.getAllByText('No signal')).toHaveLength(6);
      expect(strip().style.getPropertyValue('--strip-columns')).toBe('6');
    });

    it('shows eight tiles on a 4K wall', () => {
      stubViewportWidth(3840);

      renderStrip({ cameras: manyCameras(10) });

      expect(screen.getAllByText('No signal')).toHaveLength(8);
      expect(strip().style.getPropertyValue('--strip-columns')).toBe('8');
    });

    it("holds a wall's place while the cameras load", () => {
      stubViewportWidth(1920);

      renderStrip({ cameras: null });

      // The skeleton is a span; the header button's chevron is an `aria-hidden` svg and is not a tile.
      expect(strip().querySelectorAll('span[aria-hidden="true"]')).toHaveLength(6);
    });

    it('keeps pinned cameras first on a wall', () => {
      stubViewportWidth(1920);
      useConsole.setState({ pinnedCameraIds: ['c9', 'c8'] });

      renderStrip({ cameras: manyCameras(10) });

      expect(tileNames()).toHaveLength(6);
      expect(tileNames().slice(0, 2)).toEqual(['Camera 9', 'Camera 8']);
    });
  });

  // V3-08.2: the header row (frame 13), the filter and the collapse button.
  describe('header, filter and collapse', () => {
    const STORAGE_KEY = 'occ.console.stripCollapsed';

    /** Three online and two offline cameras; by code, an online camera comes before an offline one. */
    const mixed = [
      camera({ id: 'a', code: 'CAM-A', name: 'Atrium', online: true }),
      camera({ id: 'b', code: 'CAM-B', name: 'Back gate', online: false }),
      camera({ id: 'c', code: 'CAM-C', name: 'Canteen', online: true }),
      camera({ id: 'd', code: 'CAM-D', name: 'Dock', online: false }),
      camera({ id: 'e', code: 'CAM-E', name: 'East road', online: true }),
    ];

    /** An online camera needs a stream descriptor, or its tile asks for one and draws a canvas jsdom lacks. */
    const hls = (cameraId: string): StreamDescriptor => ({
      kind: 'hls',
      cameraId,
      label: cameraId,
      url: 'https://video.example/live.m3u8',
    });

    function renderMixed(cameras: Camera[] = mixed) {
      const client = createTestQueryClient();
      for (const c of cameras) if (c.online) client.setQueryData(queryKeys.stream(c.id), hls(c.id));
      return renderStrip({ cameras, client });
    }

    const heading = () => within(strip()).getByRole('heading', { name: 'Camera feeds' });
    const tab = (name: string) => within(strip()).getByRole('tab', { name });
    const toggle = (name: 'Hide cameras' | 'Show cameras') =>
      within(strip()).getByRole('button', { name });
    const tiles = () => within(strip()).queryAllByRole('figure');
    const tileNames = () =>
      tiles().map((tile) => tile.querySelector('figcaption')?.textContent ?? '');

    beforeEach(() => localStorage.clear());

    describe('the header', () => {
      it('has the title, the number of cameras and the three filters with their counts', () => {
        renderMixed();

        expect(heading().nextElementSibling).toHaveTextContent('5');
        expect(
          within(strip()).getByRole('tablist', { name: 'Filter cameras' }),
        ).toBeInTheDocument();
        expect(tab('All 5')).toHaveAttribute('aria-selected', 'true');
        expect(tab('Live 3')).toHaveAttribute('aria-selected', 'false');
        expect(tab('Offline 2')).toHaveAttribute('aria-selected', 'false');
      });

      it('keeps the name "Cameras" for the region', () => {
        renderMixed();

        expect(strip()).toBe(screen.getByRole('region', { name: 'Cameras' }));
      });

      it('shows no count and no filter while the cameras load', () => {
        renderStrip({ cameras: null });

        expect(heading()).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).toBeNull();
        expect(heading().nextElementSibling).toBe(toggle('Hide cameras'));
      });

      it('shows no count and no filter when the cameras could not be loaded', async () => {
        camerasAnswers = [() => apiError(500, 'Internal server error')];
        renderStrip({ cameras: null });

        expect(await screen.findByText('Cameras could not be loaded.')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).toBeNull();
        expect(heading().nextElementSibling).toBe(toggle('Hide cameras'));
      });

      it('shows no count and no filter while too many requests are retried', async () => {
        const client = new QueryClient({
          defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
        });
        camerasAnswers = [() => apiError(429, 'Too many requests')];
        const { unmount } = renderStrip({ cameras: null, client });

        await screen.findByText(RATE_LIMITED_RETRYING);
        expect(screen.queryByRole('tablist')).toBeNull();
        expect(heading().nextElementSibling).toBe(toggle('Hide cameras'));

        unmount();
        await client.cancelQueries();
      });

      it('counts a site with no camera as 0 and offers nothing to filter', () => {
        renderStrip({ cameras: [] });

        expect(heading().nextElementSibling).toHaveTextContent('0');
        expect(screen.queryByRole('tablist')).toBeNull();
        expect(screen.getByText('No cameras are set up on this site.')).toBeInTheDocument();
      });
    });

    describe('the filter', () => {
      it('lists every camera, online first, under All', () => {
        renderMixed();

        // Four tiles on a laptop; the fifth camera (Dock, offline) is the one left out.
        expect(tileNames().map((name) => name.slice(0, 4))).toEqual([
          'Atri',
          'Cant',
          'East',
          'Back',
        ]);
      });

      it('narrows the tiles to the online cameras under Live, and to the others under Offline', async () => {
        renderMixed();

        await userEvent.click(tab('Offline 2'));
        expect(tab('Offline 2')).toHaveAttribute('aria-selected', 'true');
        expect(tileNames()).toHaveLength(2);
        expect(tileNames()[0]).toContain('Back gate');
        expect(tileNames()[1]).toContain('Dock');

        await userEvent.click(tab('Live 3'));
        expect(tileNames()).toHaveLength(3);
        expect(tileNames()[0]).toContain('Atrium');
        expect(tileNames()[2]).toContain('East road');

        await userEvent.click(tab('All 5'));
        expect(tileNames()).toHaveLength(4);
      });

      it('keeps the counts of the whole list while a filter is chosen', async () => {
        renderMixed();

        await userEvent.click(tab('Offline 2'));

        expect(tab('All 5')).toBeInTheDocument();
        expect(tab('Live 3')).toBeInTheDocument();
      });

      it('moves with the arrow keys, as tabs do', async () => {
        renderMixed();
        await userEvent.click(tab('All 5'));

        await userEvent.keyboard('{ArrowRight}');

        expect(tab('Live 3')).toHaveAttribute('aria-selected', 'true');
        expect(tab('Live 3')).toHaveFocus();
        expect(tileNames()).toHaveLength(3);
      });

      it('keeps pinned cameras first within the filtered set, and drops a pin the filter excludes', async () => {
        useConsole.setState({ pinnedCameraIds: ['a', 'd'] });
        renderMixed();

        expect(tileNames().map((name) => name.slice(0, 4))).toEqual([
          'Atri',
          'Dock',
          'Cant',
          'East',
        ]);

        await userEvent.click(tab('Offline 2'));

        // Atrium is pinned but online: not in this set. Dock is pinned and first, Back gate follows.
        expect(tileNames().map((name) => name.slice(0, 4))).toEqual(['Dock', 'Back']);
      });

      it('says so when no camera is of the kind chosen', async () => {
        renderStrip({ cameras: manyCameras(3) });

        await userEvent.click(tab('Live 0'));

        expect(screen.getByText('No live cameras.')).toBeInTheDocument();
        expect(tiles()).toHaveLength(0);
        expect(tab('Live 0')).toHaveAttribute('aria-selected', 'true');
      });

      it('says so for the offline kind too', async () => {
        renderMixed(mixed.filter((c) => c.online));

        await userEvent.click(tab('Offline 0'));

        expect(screen.getByText('No offline cameras.')).toBeInTheDocument();
        expect(tiles()).toHaveLength(0);
      });
    });

    describe('collapsing', () => {
      it('has a button that says what it does and what it controls', () => {
        renderMixed();

        const button = toggle('Hide cameras');
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).not.toBeNull();
      });

      it('hides the tiles and the filter, keeps the header, and remembers the choice', async () => {
        renderMixed();

        await userEvent.click(toggle('Hide cameras'));

        const button = toggle('Show cameras');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(tiles()).toHaveLength(0);
        expect(screen.queryByRole('tablist')).toBeNull();
        expect(heading()).toBeInTheDocument();
        expect(heading().nextElementSibling).toHaveTextContent('5');
        expect(useConsole.getState().stripCollapsed).toBe(true);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
        // Still there, empty, so what the button controls always exists.
        const row = document.getElementById(button.getAttribute('aria-controls') ?? '');
        expect(row).not.toBeNull();
        expect(row).not.toBeVisible();
        expect(row).toBeEmptyDOMElement();
      });

      it('keeps the button on focus when it collapses and when it expands', async () => {
        renderMixed();

        await userEvent.click(toggle('Hide cameras'));
        expect(toggle('Show cameras')).toHaveFocus();

        await userEvent.click(toggle('Show cameras'));
        expect(toggle('Hide cameras')).toHaveFocus();
      });

      it('brings the tiles back with the filter that was chosen before', async () => {
        renderMixed();
        await userEvent.click(tab('Offline 2'));

        await userEvent.click(toggle('Hide cameras'));
        await userEvent.click(toggle('Show cameras'));

        expect(tab('Offline 2')).toHaveAttribute('aria-selected', 'true');
        expect(tileNames()).toHaveLength(2);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      });

      it('starts collapsed when the store says so', () => {
        useConsole.setState({ stripCollapsed: true });

        renderMixed();

        expect(toggle('Show cameras')).toHaveAttribute('aria-expanded', 'false');
        expect(tiles()).toHaveLength(0);
      });

      it('shows how many cameras are offline while collapsed, so a loss is not hidden', () => {
        useConsole.setState({ stripCollapsed: true });

        renderMixed();

        expect(within(strip()).getByText('2 offline')).toBeInTheDocument();
      });

      it('says nothing of offline cameras when expanded, when there are none, or before the list is loaded', () => {
        const { unmount } = renderMixed();
        expect(within(strip()).queryByText(/^\d+ offline$/)).toBeNull();
        unmount();

        useConsole.setState({ stripCollapsed: true });
        const { unmount: again } = renderMixed(mixed.filter((c) => c.online));
        expect(within(strip()).queryByText(/^\d+ offline$/)).toBeNull();
        again();

        renderStrip({ cameras: null });
        expect(within(strip()).queryByText(/^\d+ offline$/)).toBeNull();
      });

      it('shows no placeholder while collapsed', () => {
        useConsole.setState({ stripCollapsed: true });

        renderStrip({ cameras: null });

        expect(screen.queryByText('Loading cameras…')).toBeNull();
        expect(toggle('Show cameras')).toBeInTheDocument();
      });
    });

    describe('accessibility', () => {
      it('has no axe violations, expanded', async () => {
        renderMixed();

        await expectNoAxeViolations();
      });

      it('has no axe violations, collapsed', async () => {
        useConsole.setState({ stripCollapsed: true });
        renderMixed();

        await expectNoAxeViolations();
      });

      it('has no axe violations while the cameras load', async () => {
        renderStrip({ cameras: null });

        await expectNoAxeViolations();
      });
    });
  });
});

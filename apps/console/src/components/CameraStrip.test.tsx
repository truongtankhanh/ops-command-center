import type { Camera, Incident, Zone } from '@occ/contracts';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryRetryDelay, RATE_LIMITED_RETRYING, shouldRetryQuery } from '../api/client';
import { queryKeys } from '../api/queries';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  renderWithQueryClient,
  resetStore,
  stubViewportWidth,
} from '../test-utils';
import { CameraStrip } from './CameraStrip';

// No token in these cases; the API client only asks for one.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

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
  client = createTestQueryClient(),
}: { cameras?: Camera[] | null; incidents?: Incident[]; client?: QueryClient } = {}) {
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.incidents, incidents);
  if (cameras) client.setQueryData(queryKeys.cameras, cameras);
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

      expect(strip().querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
    });

    it('keeps pinned cameras first on a wall', () => {
      stubViewportWidth(1920);
      useConsole.setState({ pinnedCameraIds: ['c9', 'c8'] });

      renderStrip({ cameras: manyCameras(10) });

      expect(tileNames()).toHaveLength(6);
      expect(tileNames().slice(0, 2)).toEqual(['Camera 9', 'Camera 8']);
    });
  });
});

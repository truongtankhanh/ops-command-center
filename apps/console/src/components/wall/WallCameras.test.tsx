import type { Camera, Incident, StreamDescriptor } from '@occ/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { getAccessToken } from '../../auth/session';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubViewportWidth,
} from '../../test-utils';
import { WallCameras } from './WallCameras';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const camera = (code: string, zoneId: string, online = true): Camera => ({
  id: code,
  code,
  name: `Camera ${code}`,
  zoneId,
  position: [108.44, 11.95],
  online,
  fieldOfView: null,
});

/** A real descriptor kind that draws a notice, not a canvas jsdom does not have. */
const hls = (cameraId: string): StreamDescriptor => ({
  kind: 'hls',
  cameraId,
  label: cameraId,
  url: 'https://video.example/live.m3u8',
});

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'fire_alarm',
  severity: 'high',
  status: 'open',
  title: id,
  description: null,
  zoneId: 'zone-a',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Ten cameras: CAM-01 … CAM-10, the last two in `zone-a`; CAM-02 is offline. */
const CAMERAS: Camera[] = Array.from({ length: 10 }, (_, i) => {
  const code = `CAM-${String(i + 1).padStart(2, '0')}`;
  return camera(code, i >= 8 ? 'zone-a' : `zone-${i}`, code !== 'CAM-02');
});

function renderCameras({
  cameras = CAMERAS,
  incidents = [incident('1')],
  seed = true,
  streams = true,
}: { cameras?: Camera[]; incidents?: Incident[]; seed?: boolean; streams?: boolean } = {}) {
  const client = createTestQueryClient();
  if (seed) client.setQueryData(queryKeys.cameras, cameras);
  client.setQueryData(queryKeys.incidents, incidents);
  for (const c of cameras) {
    if (streams && c.online) client.setQueryData(queryKeys.stream(c.id), hls(c.id));
  }
  return renderWithQueryClient(<WallCameras />, client);
}

const tileCodes = () =>
  screen.getAllByRole('figure').map((figure) => /CAM-\d\d/.exec(figure.textContent ?? '')?.[0]);

describe('WallCameras', () => {
  beforeEach(() => {
    resetStore(useConsole);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    // A safety net: any query a case does not seed stays pending, and no request leaves the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    stubViewportWidth(1920);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('puts the incident’s zone first, the rest by code, an offline camera after every online one', () => {
    renderCameras();

    expect(tileCodes()).toEqual(['CAM-09', 'CAM-10', 'CAM-01', 'CAM-03', 'CAM-04', 'CAM-05']);
  });

  it('names the incident on the tiles of its zone, and on no other', () => {
    renderCameras();

    const [first, second, third] = screen.getAllByRole('figure');
    expect(within(first!).getByText('INC-1')).toBeInTheDocument();
    expect(within(second!).getByText('INC-1')).toBeInTheDocument();
    expect(within(third!).queryByText('INC-1')).toBeNull();
  });

  it('follows the incident the wall holds in focus', () => {
    const incidents = [incident('1'), incident('2', { zoneId: 'zone-4', severity: 'low' })];
    useConsole.setState({ wallFocusId: '2' });

    renderCameras({ incidents });

    expect(tileCodes()[0]).toBe('CAM-05');
    expect(within(screen.getAllByRole('figure')[0]!).getByText('INC-2')).toBeInTheDocument();
  });

  it('has the default order, and no tag, when no incident is active', () => {
    renderCameras({ incidents: [incident('1', { status: 'resolved' })] });

    expect(tileCodes()).toEqual(['CAM-01', 'CAM-03', 'CAM-04', 'CAM-05', 'CAM-06', 'CAM-07']);
    expect(screen.queryByText(/^INC-/)).toBeNull();
  });

  it('holds six tiles at 1920 and at 4K, and four on a smaller window', () => {
    const { unmount } = renderCameras();
    expect(screen.getAllByRole('figure')).toHaveLength(6);
    unmount();

    vi.unstubAllGlobals();
    stubViewportWidth(3840);
    const wide = renderCameras();
    expect(screen.getAllByRole('figure')).toHaveLength(6);
    wide.unmount();

    vi.unstubAllGlobals();
    stubViewportWidth(1280);
    renderCameras();
    expect(screen.getAllByRole('figure')).toHaveLength(4);
  });

  it('is a list of figures with captions, and nothing to press', () => {
    const { container } = renderCameras();

    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(container.querySelectorAll('button, a[href], input, [tabindex]')).toHaveLength(0);
    for (const figure of screen.getAllByRole('figure')) {
      expect(figure.querySelector('figcaption')).not.toBeNull();
    }
  });

  it('says No signal, with the camera’s code, for a camera that is offline', () => {
    // Fewer cameras, so the offline one is among the tiles.
    renderCameras({ cameras: CAMERAS.slice(0, 3), incidents: [] });

    const offline = screen.getAllByRole('figure').find((f) => f.textContent?.includes('CAM-02'));
    expect(within(offline!).getByText('No signal')).toBeInTheDocument();
    expect(within(offline!).queryByText('LIVE')).toBeNull();
  });

  it('says No signal, and offers no Retry, for a stream that cannot be resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
    );
    renderCameras({ cameras: CAMERAS.slice(2, 4), incidents: [], streams: false });

    // `findAllBy…` returns at the first match: wait until both tiles have given up.
    await waitFor(() => expect(screen.getAllByText('Stream unavailable')).toHaveLength(2));
    expect(screen.getAllByText('No signal')).toHaveLength(2);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('holds the height with placeholders while the cameras load', () => {
    renderCameras({ seed: false });

    expect(screen.getByRole('status')).toHaveTextContent('Loading cameras…');
    expect(screen.queryAllByRole('figure')).toHaveLength(0);
  });

  it('says so, as a line and not a button, when the cameras cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
    );
    renderCameras({ seed: false });

    expect(await screen.findByText('Cameras could not be loaded.')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('says so when no camera is set up', () => {
    renderCameras({ cameras: [], incidents: [] });

    expect(screen.getByText('No cameras are set up on this site.')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    renderCameras();

    await expectNoAxeViolations();
  });
});

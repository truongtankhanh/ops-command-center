import type { Camera, StreamDescriptor, Zone } from '@occ/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { queryKeys } from '../api/queries';
import { getAccessToken } from '../auth/session';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { CameraTile } from './CameraTile';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const CLOCK = /^\d{2}:\d{2}:\d{2}$/;
const STRIP_FULL = 'You can pin 4 cameras to the strip. Unpin one first.';

const camera = (overrides: Partial<Camera> = {}): Camera => ({
  id: 'c1',
  code: 'CAM-L01',
  name: 'Library entrance',
  zoneId: 'z1',
  position: [108.44, 11.95],
  online: true,
  fieldOfView: null,
  ...overrides,
});

const zone: Zone = {
  id: 'z1',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: [108.44, 11.95],
};

/** A real descriptor kind that draws a notice, not a canvas jsdom does not have. */
const hls = (cameraId: string): StreamDescriptor => ({
  kind: 'hls',
  cameraId,
  label: cameraId,
  url: 'https://video.example/live.m3u8',
});

/** Five cameras for the pin limit: `c1` … `c5`, coded `CAM-01` … `CAM-05`. */
const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    camera({ id: `c${i + 1}`, code: `CAM-0${i + 1}`, name: `Camera ${i + 1}` }),
  );

function renderTile(
  props: Partial<ComponentProps<typeof CameraTile>> = {},
  {
    cameras = [camera()],
    zones = [zone],
    streams = true,
  }: { cameras?: Camera[]; zones?: Zone[] | null; streams?: boolean } = {},
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.cameras, cameras);
  if (zones) client.setQueryData(queryKeys.zones, zones);
  if (streams) cameras.forEach((c) => client.setQueryData(queryKeys.stream(c.id), hls(c.id)));
  return renderWithQueryClient(<CameraTile camera={cameras[0]!} {...props} />, client);
}

const button = (name: string) => screen.getByRole('button', { name });
const pins = () => useConsole.getState().pinnedCameraIds;

describe('CameraTile', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStore(useConsole);
    localStorage.clear();
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    // A safety net: any query a case does not seed stays pending, and no request leaves the test.
    fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('chrome', () => {
    it('shows a live strip tile with its code, zone and time', () => {
      renderTile();

      expect(screen.getByText('LIVE')).toBeInTheDocument();
      expect(screen.getByText('CAM-L01')).toBeInTheDocument();
      expect(screen.getByText('Library entrance')).toBeInTheDocument();
      expect(screen.getByText('Library')).toBeInTheDocument();
      expect(screen.getByText(CLOCK)).toBeInTheDocument();
    });

    it("marks a tile in the selected incident's zone", () => {
      renderTile({ linked: true });

      expect(screen.getByText('In zone')).toBeInTheDocument();
      // The tag takes the code's place, so the code moves to the zone line (frame 02).
      expect(screen.getByText('Library · CAM-L01')).toBeInTheDocument();
      expect(screen.queryByText('CAM-L01')).toBeNull();
    });

    it('keeps a compact live tile to LIVE and the name', () => {
      renderTile({ variant: 'compact' });

      expect(screen.getByText('LIVE')).toBeInTheDocument();
      expect(screen.getByText('Library entrance')).toBeInTheDocument();
      expect(screen.queryByText('CAM-L01')).toBeNull();
      expect(screen.queryByText('Library')).toBeNull();
      expect(screen.queryByText(CLOCK)).toBeNull();
    });
  });

  describe('no picture', () => {
    it('shows an offline camera without LIVE or time', () => {
      renderTile({}, { cameras: [camera({ online: false })], streams: false });

      expect(screen.getByText('No signal')).toBeInTheDocument();
      expect(screen.getByText('Camera offline')).toBeInTheDocument();
      expect(screen.getByText('CAM-L01')).toBeInTheDocument();
      expect(screen.queryByText('LIVE')).toBeNull();
      expect(screen.queryByText(CLOCK)).toBeNull();
    });

    it('shows the code on a compact offline tile', () => {
      renderTile({ variant: 'compact' }, { cameras: [camera({ online: false })], streams: false });

      expect(screen.getByText('CAM-L01')).toBeInTheDocument();
      expect(screen.getByText('No signal')).toBeInTheDocument();
      expect(screen.queryByText('LIVE')).toBeNull();
    });

    it('claims no LIVE while the stream is still resolving', async () => {
      renderTile({}, { streams: false });

      expect(screen.queryByText('LIVE')).toBeNull();
      expect(screen.queryByText(CLOCK)).toBeNull();
      expect(screen.queryByText('No signal')).toBeNull();
      // The client awaits the access token before it calls `fetch`.
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/cameras/c1/stream', expect.anything()),
      );
    });

    it('shows the code alone on the zone line before the zones arrive', () => {
      renderTile({ linked: true }, { zones: null });

      expect(screen.getByText('In zone')).toBeInTheDocument();
      expect(screen.getByText('CAM-L01')).toBeInTheDocument();
      expect(screen.queryByText('Library')).toBeNull();
    });
  });

  describe('actions', () => {
    it('opens the camera in the viewer', async () => {
      renderTile();

      await userEvent.click(button('Open CAM-L01 in the viewer'));

      expect(useConsole.getState().viewerCameraId).toBe('c1');
      expect(pins()).toEqual([]);
    });

    it('pins the camera to the strip, then unpins it', async () => {
      renderTile();

      await userEvent.click(button('Pin CAM-L01 to the strip'));
      expect(pins()).toEqual(['c1']);

      await userEvent.click(button('Unpin CAM-L01'));
      expect(pins()).toEqual([]);
      expect(button('Pin CAM-L01 to the strip')).toBeInTheDocument();
    });
  });

  // Four pins fill the strip (D7): a fifth is refused with a reason, never silently dropped.
  describe('the pin limit', () => {
    it('refuses a fifth pin, and says why', async () => {
      useConsole.setState({ pinnedCameraIds: ['c2', 'c3', 'c4', 'c5'] });
      renderTile({}, { cameras: numbered(5) });
      const pin = button('Pin CAM-01 to the strip');

      expect(pin).toHaveAttribute('aria-disabled', 'true');
      expect(pin).toHaveAccessibleDescription(STRIP_FULL);

      await userEvent.click(pin);
      expect(pins()).toEqual(['c2', 'c3', 'c4', 'c5']);

      // `aria-disabled`, not `disabled`: the hint stays reachable from the keyboard.
      pin.focus();
      expect(pin).toHaveFocus();
    });

    it('lets a pinned camera be unpinned from a full strip', async () => {
      useConsole.setState({ pinnedCameraIds: ['c1', 'c2', 'c3', 'c4'] });
      renderTile({}, { cameras: numbered(5) });
      const unpin = button('Unpin CAM-01');

      expect(unpin).not.toHaveAttribute('aria-disabled');

      await userEvent.click(unpin);
      expect(pins()).toEqual(['c2', 'c3', 'c4']);
    });

    it('ignores pins of cameras that are gone', async () => {
      useConsole.setState({ pinnedCameraIds: ['gone-1', 'gone-2', 'c2', 'c3'] });
      renderTile({}, { cameras: numbered(3) });
      const pin = button('Pin CAM-01 to the strip');

      expect(pin).not.toHaveAttribute('aria-disabled');

      await userEvent.click(pin);
      expect(pins()).toEqual(['c2', 'c3', 'c1']);
    });
  });
});

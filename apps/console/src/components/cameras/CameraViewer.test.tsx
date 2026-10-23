import type { Camera, StreamDescriptor, Zone } from '@occ/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { getAccessToken } from '../auth/session';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { CameraViewer } from './CameraViewer';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const CLOCK = /^\d{2}:\d{2}:\d{2}$/;

const camera = (overrides: Partial<Camera>): Camera => ({
  id: 'c1',
  code: 'CAM-L01',
  name: 'Library entrance',
  zoneId: 'z1',
  position: [108.44, 11.95],
  online: true,
  fieldOfView: null,
  ...overrides,
});

/** Two cameras in the Library (one offline) and one at the Main Gate. */
const CAMERAS = [
  camera({}),
  camera({ id: 'c2', code: 'CAM-L02', name: 'Library reading room', online: false }),
  camera({ id: 'c3', code: 'CAM-G01', name: 'Main gate inbound', zoneId: 'z2' }),
];

const ZONES: Zone[] = [
  { id: 'z1', code: 'BLD-LIB', name: 'Library', kind: 'building', polygon: [], center: [0, 0] },
  { id: 'z2', code: 'GATE-MAIN', name: 'Main Gate', kind: 'gate', polygon: [], center: [0, 0] },
];

/** A real descriptor kind that draws a notice, not a canvas jsdom does not have. */
const hls = (cameraId: string): StreamDescriptor => ({
  kind: 'hls',
  cameraId,
  label: cameraId,
  url: 'https://video.example/live.m3u8',
});

/** The viewer beside an opener, so `Dialog` has a real element to give focus back to. */
function Harness() {
  return (
    <>
      <button onClick={() => useConsole.getState().openViewer('c1')}>Open viewer</button>
      <CameraViewer />
    </>
  );
}

function renderViewer({
  cameras = true,
  zones = true,
}: { cameras?: boolean; zones?: boolean } = {}) {
  const client = createTestQueryClient();
  if (cameras) client.setQueryData(queryKeys.cameras, CAMERAS);
  if (zones) client.setQueryData(queryKeys.zones, ZONES);
  client.setQueryData(queryKeys.stream('c1'), hls('c1'));
  client.setQueryData(queryKeys.stream('c3'), hls('c3'));
  return renderWithQueryClient(<Harness />, client);
}

const opener = () => screen.getByRole('button', { name: 'Open viewer' });
const viewer = (name = 'Library entrance · CAM-L01') => screen.getByRole('dialog', { name });
const closeButton = () => screen.getByRole('button', { name: 'Close' });
const zoneList = (name = 'Cameras in Library') => screen.getByRole('navigation', { name });
const listButton = (name: RegExp) => within(zoneList()).getByRole('button', { name });

async function openViewer() {
  await userEvent.click(opener());
  return viewer();
}

describe('CameraViewer', () => {
  beforeEach(() => {
    resetStore(useConsole);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    // A safety net: any query a case does not seed stays pending, and no request leaves the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as { fullscreenEnabled?: boolean }).fullscreenEnabled;
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });

  describe('opening', () => {
    it('stays closed until a camera is opened', () => {
      renderViewer();

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens the camera named in its title, with Close focused', async () => {
      renderViewer();

      await openViewer();

      expect(viewer('Library entrance · CAM-L01')).toBeInTheDocument();
      expect(closeButton()).toHaveFocus();
    });

    // UI-16 Q11: the list would otherwise be read out as the description every time it opens.
    it('is described by the picture, not by the list of cameras', async () => {
      renderViewer();

      const dialog = await openViewer();

      const description = document.getElementById(dialog.getAttribute('aria-describedby')!);
      expect(description).not.toBeNull();
      expect(description).not.toContainElement(zoneList());
      expect(dialog).not.toHaveAccessibleDescription(/Cameras in|Library reading room/);
    });

    it('lists the cameras of the zone, the shown one marked', async () => {
      renderViewer();
      await openViewer();

      const buttons = within(zoneList()).getAllByRole('button');
      expect(buttons).toHaveLength(2);
      expect(listButton(/Library entrance/)).toHaveAttribute('aria-current', 'true');
      expect(listButton(/Library reading room/)).not.toHaveAttribute('aria-current');
      expect(within(zoneList()).queryByText('Main gate inbound')).toBeNull();
      expect(within(zoneList()).getByText('CAM-L02 · Offline')).toBeInTheDocument();
    });

    it('shows LIVE and the time over a live picture', async () => {
      renderViewer();

      const dialog = await openViewer();

      expect(within(dialog).getByText('LIVE')).toBeInTheDocument();
      expect(within(dialog).getByText(CLOCK)).toBeInTheDocument();
    });

    it('switches to another camera of the zone and keeps the viewer open', async () => {
      renderViewer();
      await openViewer();

      await userEvent.click(listButton(/Library reading room/));

      expect(viewer('Library reading room · CAM-L02')).toBeInTheDocument();
      expect(useConsole.getState().viewerCameraId).toBe('c2');
      expect(listButton(/Library reading room/)).toHaveAttribute('aria-current', 'true');
      expect(listButton(/Library reading room/)).toHaveFocus();
      expect(screen.getByText('No signal')).toBeInTheDocument();
      expect(screen.queryByText('LIVE')).toBeNull();
    });
  });

  // Acceptance criterion of UI-13: the viewer is keyboard accessible (focus trap, Escape).
  describe('keyboard', () => {
    it('closes on Close and gives focus back to the opener', async () => {
      renderViewer();
      await openViewer();

      await userEvent.click(closeButton());

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useConsole.getState().viewerCameraId).toBeNull();
      await waitFor(() => expect(opener()).toHaveFocus());
    });

    it('closes on Escape and gives focus back to the opener', async () => {
      renderViewer();
      await openViewer();

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useConsole.getState().viewerCameraId).toBeNull();
      await waitFor(() => expect(opener()).toHaveFocus());
    });

    it('keeps Tab inside the viewer', async () => {
      renderViewer();
      await openViewer();

      await userEvent.tab();
      expect(listButton(/Library entrance/)).toHaveFocus();

      await userEvent.tab({ shift: true });
      expect(closeButton()).toHaveFocus();
    });
  });

  describe('data still on its way', () => {
    it('waits for the camera list, then opens', async () => {
      const { client } = renderViewer({ cameras: false });

      await userEvent.click(opener());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useConsole.getState().viewerCameraId).toBe('c1');

      act(() => client.setQueryData(queryKeys.cameras, CAMERAS));

      expect(
        await screen.findByRole('dialog', { name: 'Library entrance · CAM-L01' }),
      ).toBeInTheDocument();
    });

    it("falls back to 'this zone' before the zones arrive", async () => {
      renderViewer({ zones: false });
      await openViewer();

      expect(zoneList('Cameras in this zone')).toBeInTheDocument();
    });
  });

  describe('fullscreen', () => {
    it('offers no Fullscreen where the browser has none', async () => {
      renderViewer();
      await openViewer();

      expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull();
    });

    it('asks the browser for fullscreen on the picture, and stays open when refused', async () => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      const requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')));
      HTMLElement.prototype.requestFullscreen = requestFullscreen;
      renderViewer();
      await openViewer();

      await userEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
      await act(async () => {});

      expect(requestFullscreen).toHaveBeenCalledOnce();
      // The picture box, not the whole dialog: the camera list stays out of fullscreen.
      const target = requestFullscreen.mock.contexts[0] as HTMLElement;
      expect(target).toHaveTextContent('Live player arrives in M2');
      expect(target).not.toHaveTextContent('Library reading room');
      expect(viewer()).toBeInTheDocument();
    });
  });
});

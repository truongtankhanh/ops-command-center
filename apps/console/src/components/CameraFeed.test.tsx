import type { Camera, StreamDescriptor } from '@occ/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { getAccessToken } from '../auth/session';
import { createTestQueryClient, renderWithQueryClient } from '../test-utils';
import { CameraFeed } from './CameraFeed';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const PLAYER_PENDING = 'Live player arrives in M2';

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

const HLS: StreamDescriptor = {
  kind: 'hls',
  cameraId: 'c1',
  label: 'c1',
  url: 'https://video.example/live.m3u8',
};
const WEBRTC: StreamDescriptor = { ...HLS, kind: 'webrtc', url: 'https://video.example/whep' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const serverError = () => json({ statusCode: 500, message: 'boom' }, 500);

/** Renders the feed with a fresh client (no retries), seeding the stream when given. */
function renderFeed(cam = camera(), stream?: StreamDescriptor) {
  const client = createTestQueryClient();
  if (stream) client.setQueryData(queryKeys.stream(cam.id), stream);
  return renderWithQueryClient(<CameraFeed camera={cam} />, client);
}

const retry = () => screen.getByRole('button', { name: 'Retry' });

describe('CameraFeed', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    // Unless a case says otherwise, the stream request never settles.
    fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('a stream', () => {
    it('draws the player notice for an HLS stream it fetched', async () => {
      fetchMock.mockResolvedValueOnce(json(HLS));
      renderFeed();

      expect(await screen.findByText(PLAYER_PENDING)).toBeInTheDocument();
      expect(screen.getByText('HLS / WebRTC playback is not built yet')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith('/api/cameras/c1/stream', expect.anything());
    });

    it('draws the same notice for WebRTC', () => {
      renderFeed(camera(), WEBRTC);

      expect(screen.getByText(PLAYER_PENDING)).toBeInTheDocument();
    });

    it('shows a simulated picture for a mock stream', () => {
      // jsdom has no canvas; the feed draws nothing without a 2D context and still shows the image.
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      renderFeed(camera(), { kind: 'mock', cameraId: 'c1', label: 'c1', seed: 7 });

      expect(screen.getByRole('img', { name: 'Simulated camera feed' })).toBeInTheDocument();
    });
  });

  describe('no picture', () => {
    it('says an offline camera has no signal, without asking for its stream', async () => {
      renderFeed(camera({ online: false }));

      expect(screen.getByText('No signal')).toBeInTheDocument();
      expect(screen.getByText('Camera offline')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      // The client awaits the token before `fetch`: let that settle, so "no request" means something.
      await act(async () => {});
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('offers Retry when the stream cannot be resolved', async () => {
      fetchMock.mockResolvedValueOnce(serverError());
      renderFeed();

      expect(await screen.findByText('Stream unavailable')).toBeInTheDocument();
      expect(retry()).toBeEnabled();
    });

    it('retries, busy while it waits, then shows the stream', async () => {
      let resolve!: (response: Response) => void;
      fetchMock
        .mockResolvedValueOnce(serverError())
        .mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
      renderFeed();
      await screen.findByText('Stream unavailable');

      await userEvent.click(retry());
      await waitFor(() => expect(retry()).toHaveAttribute('aria-busy', 'true'));
      expect(retry()).toBeDisabled();

      act(() => resolve(json(HLS)));

      expect(await screen.findByText(PLAYER_PENDING)).toBeInTheDocument();
      expect(screen.queryByText('Stream unavailable')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps offering Retry when it fails again', async () => {
      let resolve!: (response: Response) => void;
      fetchMock
        .mockResolvedValueOnce(serverError())
        .mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
      renderFeed();
      await screen.findByText('Stream unavailable');

      await userEvent.click(retry());
      // Busy first, so the check below cannot pass before the second request has even started.
      await waitFor(() => expect(retry()).toHaveAttribute('aria-busy', 'true'));

      act(() => resolve(serverError()));

      await waitFor(() => expect(retry()).not.toHaveAttribute('aria-busy'));
      expect(screen.getByText('Stream unavailable')).toBeInTheDocument();
      expect(retry()).toBeEnabled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('announces nothing while the stream resolves', () => {
      renderFeed();

      expect(screen.queryByText('No signal')).toBeNull();
      expect(screen.queryByText('Stream unavailable')).toBeNull();
      expect(screen.queryByText(PLAYER_PENDING)).toBeNull();
      // The skeleton is `aria-hidden`: no picture, and nothing for assistive tech to read.
      expect(screen.queryByRole('img')).toBeNull();
    });
  });
});

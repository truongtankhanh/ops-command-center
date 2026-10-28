import type { Camera, StreamDescriptor, Zone } from '@occ/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { queryKeys } from '../../api/queries';
import { getAccessToken } from '../../auth/session';
import type { StripSubject } from '../../lib/cameras/cameras';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { CameraGrid } from './CameraGrid';
import { CameraViewer } from './CameraViewer';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const camera = (overrides: Partial<Camera>): Camera => ({
  id: 'a',
  code: 'CAM-A',
  name: 'Atrium',
  zoneId: 'z1',
  position: [108.44, 11.95],
  online: true,
  fieldOfView: null,
  ...overrides,
});

/** Seven cameras, more than the strip ever shows: four online (A, C, E, F) and three offline (B, D, G). */
const CAMERAS: Camera[] = [
  camera({ id: 'a', code: 'CAM-A', name: 'Atrium', zoneId: 'z1' }),
  camera({ id: 'b', code: 'CAM-B', name: 'Back gate', zoneId: 'z2', online: false }),
  camera({ id: 'c', code: 'CAM-C', name: 'Canteen', zoneId: 'z1' }),
  camera({ id: 'd', code: 'CAM-D', name: 'Dock', zoneId: 'z2', online: false }),
  camera({ id: 'e', code: 'CAM-E', name: 'East road', zoneId: 'z2' }),
  camera({ id: 'f', code: 'CAM-F', name: 'Foyer', zoneId: 'z1' }),
  camera({ id: 'g', code: 'CAM-G', name: 'Garage', zoneId: 'z1', online: false }),
];

const ZONES: Zone[] = [
  { id: 'z1', code: 'BLD-LIB', name: 'Library', kind: 'building', polygon: [], center: [0, 0] },
  { id: 'z2', code: 'GATE-N', name: 'North gate', kind: 'gate', polygon: [], center: [0, 0] },
];

/** A descriptor kind that draws a notice, not a canvas jsdom does not have. */
const hls = (cameraId: string): StreamDescriptor => ({
  kind: 'hls',
  cameraId,
  label: cameraId,
  url: 'https://video.example/live.m3u8',
});

/** The grid beside an opener, so `Dialog` has a real element to give focus back to, and the one viewer `App` mounts. */
function Harness({ cameras, subject }: { cameras: Camera[]; subject?: StripSubject | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open grid</button>
      {open && <CameraGrid cameras={cameras} subject={subject} onClose={() => setOpen(false)} />}
      <CameraViewer />
    </>
  );
}

function renderGrid({
  cameras = CAMERAS,
  subject,
}: { cameras?: Camera[]; subject?: StripSubject } = {}) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.cameras, cameras);
  client.setQueryData(queryKeys.zones, ZONES);
  for (const c of cameras) if (c.online) client.setQueryData(queryKeys.stream(c.id), hls(c.id));
  return renderWithQueryClient(<Harness cameras={cameras} subject={subject} />, client);
}

const opener = () => screen.getByRole('button', { name: 'Open grid' });
const grid = () => screen.getByRole('dialog', { name: 'All cameras' });
const tab = (name: string) => within(grid()).getByRole('tab', { name });
/** The codes of the tiles, in order, from the button that opens each in the viewer. */
const codes = () =>
  within(grid())
    .getAllByRole('button', { name: /^Open CAM-.* in the viewer$/ })
    .map((button) => /CAM-\w+/.exec(button.getAttribute('aria-label') ?? '')?.[0]);

async function openGrid() {
  await userEvent.click(opener());
  return grid();
}

describe('CameraGrid', () => {
  beforeEach(() => {
    resetStore(useConsole);
    localStorage.clear();
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    // A safety net: any query a case does not seed stays pending, and no request leaves the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('the list', () => {
    it('lists every camera, more than the strip shows, under the title "All cameras"', async () => {
      renderGrid();

      const dialog = await openGrid();

      expect(within(dialog).getAllByRole('figure')).toHaveLength(7);
      expect(within(dialog).getByRole('heading', { name: 'All cameras' })).toBeInTheDocument();
    });

    it('has the three filters with the counts of the whole list', async () => {
      renderGrid();
      const dialog = await openGrid();

      expect(within(dialog).getByRole('tablist', { name: 'Filter all cameras' })).toBeVisible();
      expect(tab('All 7')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Live 4')).toBeInTheDocument();
      expect(tab('Offline 3')).toBeInTheDocument();
    });

    it('is described by a short line, not by the tiles', async () => {
      renderGrid();

      expect(await openGrid()).toHaveAccessibleDescription('7 cameras on this site');
    });

    it('says "camera" for one', async () => {
      renderGrid({ cameras: [camera({})] });

      expect(await openGrid()).toHaveAccessibleDescription('1 camera on this site');
    });

    it('says so, and offers nothing to filter, when the site has no camera', async () => {
      renderGrid({ cameras: [] });
      const dialog = await openGrid();

      expect(within(dialog).getByText('No cameras are set up on this site.')).toBeInTheDocument();
      expect(within(dialog).queryByRole('tablist')).toBeNull();
      expect(dialog).toHaveAccessibleDescription('0 cameras on this site');
    });
  });

  describe('the filter', () => {
    it('narrows the tiles to the online cameras under Live, and to the others under Offline', async () => {
      renderGrid();
      await openGrid();

      await userEvent.click(tab('Live 4'));
      expect(codes()).toEqual(['CAM-A', 'CAM-C', 'CAM-E', 'CAM-F']);

      await userEvent.click(tab('Offline 3'));
      expect(codes()).toEqual(['CAM-B', 'CAM-D', 'CAM-G']);

      await userEvent.click(tab('All 7'));
      expect(codes()).toHaveLength(7);
    });

    it('keeps the counts of the whole list while a filter is chosen', async () => {
      renderGrid();
      await openGrid();

      await userEvent.click(tab('Offline 3'));

      expect(tab('All 7')).toBeInTheDocument();
      expect(tab('Live 4')).toBeInTheDocument();
    });

    it('moves with the arrow keys, as tabs do', async () => {
      renderGrid();
      await openGrid();
      tab('All 7').focus();

      await userEvent.keyboard('{ArrowRight}');

      expect(tab('Live 4')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Live 4')).toHaveFocus();
    });

    it('says so when no camera is of the kind chosen', async () => {
      renderGrid({ cameras: CAMERAS.filter((c) => c.online) });
      const dialog = await openGrid();

      await userEvent.click(tab('Offline 0'));

      expect(within(dialog).getByText('No offline cameras.')).toBeInTheDocument();
      expect(within(dialog).queryAllByRole('figure')).toHaveLength(0);
    });

    it('starts at All each time it is opened', async () => {
      renderGrid();
      await openGrid();
      await userEvent.click(tab('Offline 3'));
      await userEvent.keyboard('{Escape}');

      await openGrid();

      expect(tab('All 7')).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('the order', () => {
    it('puts every online camera before every offline one, by code', async () => {
      renderGrid();
      await openGrid();

      expect(codes()).toEqual(['CAM-A', 'CAM-C', 'CAM-E', 'CAM-F', 'CAM-B', 'CAM-D', 'CAM-G']);
    });

    it("puts the selected incident's zone first, and tags those cameras", async () => {
      renderGrid({ subject: { kind: 'zone', zoneId: 'z2' } });
      const dialog = await openGrid();

      expect(codes()).toEqual(['CAM-E', 'CAM-A', 'CAM-C', 'CAM-F', 'CAM-B', 'CAM-D', 'CAM-G']);
      // The three cameras of North gate, whether they are online or not.
      expect(within(dialog).getAllByText('In zone')).toHaveLength(3);
    });

    it('does not move a tile when it is pinned or unpinned', async () => {
      renderGrid();
      const dialog = await openGrid();
      const before = codes();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Pin CAM-F to the strip' }));
      expect(useConsole.getState().pinnedCameraIds).toEqual(['f']);
      expect(codes()).toEqual(before);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Unpin CAM-F' }));
      expect(useConsole.getState().pinnedCameraIds).toEqual([]);
      expect(codes()).toEqual(before);
    });
  });

  describe('closing', () => {
    it('starts with focus on Close', async () => {
      renderGrid();
      const dialog = await openGrid();

      expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    });

    it('closes on Close and gives focus back to the opener', async () => {
      renderGrid();
      const dialog = await openGrid();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(opener()).toHaveFocus());
    });

    it('closes on Escape and gives focus back to the opener', async () => {
      renderGrid();
      await openGrid();

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(opener()).toHaveFocus());
    });
  });

  describe('opening a camera', () => {
    const openInViewer = (code: string) =>
      within(grid()).getByRole('button', { name: `Open ${code} in the viewer` });

    it('opens the viewer above the grid and leaves the grid open', async () => {
      renderGrid();
      await openGrid();

      await userEvent.click(openInViewer('CAM-A'));

      expect(useConsole.getState().viewerCameraId).toBe('a');
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs).toHaveLength(2);
      // The later one in the document stacks above the earlier at the same z-index.
      expect(dialogs[0]).toHaveAccessibleName('All cameras');
      expect(dialogs[1]).toHaveAccessibleName('Atrium · CAM-A');
    });

    it('closes only the viewer on Escape, and gives focus back to the tile', async () => {
      renderGrid();
      await openGrid();
      await userEvent.click(openInViewer('CAM-A'));

      await userEvent.keyboard('{Escape}');

      expect(useConsole.getState().viewerCameraId).toBeNull();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(grid()).toBeInTheDocument();
      await waitFor(() => expect(openInViewer('CAM-A')).toHaveFocus());
    });

    it('leaves the selection and the report form as they were', async () => {
      useConsole.setState({ selectedIncidentId: 'i1', reporting: false });
      renderGrid();
      await openGrid();
      const kept = () => {
        const { selectedIncidentId, selectedAssetCode, reporting } = useConsole.getState();
        return { selectedIncidentId, selectedAssetCode, reporting };
      };
      const before = kept();

      await userEvent.click(openInViewer('CAM-C'));

      expect(kept()).toEqual(before);
      expect(useConsole.getState().viewerCameraId).toBe('c');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations, with every camera', async () => {
      renderGrid({ subject: { kind: 'zone', zoneId: 'z2' } });
      await openGrid();

      await expectNoAxeViolations();
    });

    it('has no axe violations when no camera is of the kind chosen', async () => {
      renderGrid({ cameras: CAMERAS.filter((c) => c.online) });
      await openGrid();
      await userEvent.click(tab('Offline 0'));

      await expectNoAxeViolations();
    });

    it('has no axe violations when the site has no camera', async () => {
      renderGrid({ cameras: [] });
      await openGrid();

      await expectNoAxeViolations();
    });
  });
});

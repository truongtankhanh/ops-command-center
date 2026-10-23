import type { SitePlan, Zone } from '@occ/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import { TWIN_UNAVAILABLE_COPY } from '../lib/twin-core/twinCapability';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from '../test-utils';
import { CampusMap } from './map/CampusMap';
import { LazyTwinStage, StageView } from './StageView';

// MapLibre needs WebGL, which jsdom does not have; the map's own tests cover the map.
vi.mock('./map/CampusMap', () => ({ CampusMap: vi.fn(() => null) }));

// The 3D chunk, stood in for: R3F needs WebGL too. A mock factory runs when the module is first
// imported, so `twin.evaluated` says whether anything asked for the chunk, and `twin.fail` makes
// that import fail (a chunk that cannot be fetched). The factory stays synchronous: the registry then
// forgets a failed import, so a Retry runs it again.
const twin = vi.hoisted(() => ({ evaluated: 0, fail: false, crash: false }));
vi.mock('../twin/TwinStage', () => {
  twin.evaluated += 1;
  if (twin.fail) throw new Error('chunk failed to load');
  return {
    default: ({ wall }: { wall?: boolean }) => {
      // A stage that breaks once it is drawn, for the boundary (the factory above is the chunk failing to load).
      if (twin.crash) throw new Error('stage failed to render');
      return <div>{wall ? '3D stage (wall)' : '3D stage'}</div>;
    },
  };
});

const PLAN: SitePlan = { id: 'plan-1', code: 'P', name: 'Plan', center: [0, 0], features: [] };

/** The site's reference data already in the cache, as it is once the 2D map has loaded. */
function seededClient() {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, []);
  client.setQueryData(queryKeys.sitePlan, PLAN);
  return client;
}

/** The stage inside a query provider: the 3D branch reads the zones and the site plan for its card. */
const renderStage = (client = seededClient()) => renderWithQueryClient(<StageView />, client);

const show3d = () => act(() => useConsole.setState({ view: '3d' }));

const DATA_CENTER: Zone = {
  id: 'z-dc',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  polygon: [],
  center: [0, 0],
};

/** A client that holds the building the breadcrumb names. */
function clientWithBuilding() {
  const client = seededClient();
  client.setQueryData(queryKeys.zones, [DATA_CENTER]);
  return client;
}

const crumbsNav = () => screen.queryByRole('navigation', { name: 'Scene level' });

describe('StageView', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
    vi.mocked(CampusMap).mockClear();
    twin.evaluated = 0;
    twin.fail = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    unstubTwin();
  });

  it('draws the 2D map with the view switch over it', () => {
    render(<StageView />);

    expect(CampusMap).toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
  });

  it('offers the 2D map the three layers', () => {
    render(<StageView />);

    const layers = screen.getByRole('group', { name: 'Layers' });
    expect(
      within(layers)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Incidents', 'Cameras', 'Assets']);
  });

  it('offers the layers control beside the view switch', () => {
    render(<StageView />);

    expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
  });

  // jsdom has no WebGL 2, so the store never holds `3d` here (see `effectiveView`): what is stored cannot change
  // what is drawn: the stage keeps showing the map and the switch shows 2D pressed.
  it('still draws the map when a 3D choice was stored by a later build', () => {
    localStorage.setItem('occ.console.view', '3d');

    render(<StageView />);

    expect(CampusMap).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('occ.console.view')).toBe('3d');
  });
  // These cases are in order on purpose: the module registry keeps a chunk that loaded, and so does
  // `StageView` (it remembers the chunk came in), so the case that needs the first import to fail comes
  // before the ones that load it.
  describe('the 3D branch', () => {
    it('does not ask for the 3D chunk while the 2D map is shown', () => {
      render(<StageView />);

      expect(twin.evaluated).toBe(0);
    });

    // The first import of the chunk fails here; Retry then loads it, which also shows the card with the code step
    // on its way (the site plan is in the cache) and drops it once the stage is there.
    it('keeps the switch and the 2D choice when the chunk cannot be loaded, and Retry tries again', async () => {
      twin.fail = true;
      // The boundary logs the failure, as it does for any region that breaks.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      renderStage();

      show3d();

      expect(await screen.findByText('The 3D view stopped working.')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();

      twin.fail = false;
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      const busy = screen.getByRole('region', { name: 'Campus 3D view, loading' });
      expect(busy).toHaveAttribute('aria-busy', 'true');
      expect(
        within(within(busy).getByRole('status'))
          .getAllByRole('listitem')
          .map((row) => row.getAttribute('data-state')),
      ).toEqual(['done', 'active']);

      expect(await screen.findByText('3D stage')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
      expect(screen.getByRole('region', { name: 'Campus 3D view' })).toHaveAttribute(
        'aria-busy',
        'false',
      );
      logged.mockRestore();
    });

    it('shows the card again, with the code done, while only the site plan is on its way', async () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      renderStage(createTestQueryClient());

      show3d();

      expect(await screen.findByText('3D stage')).toBeInTheDocument();
      const card = screen.getByRole('status');
      expect(
        within(card)
          .getAllByRole('listitem')
          .map((row) => row.getAttribute('data-state')),
      ).toEqual(['active', 'done']);
      expect(screen.getByRole('region', { name: 'Campus 3D view, loading' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });

    it('keeps the failed step on the card with a Retry, no longer busy, and draws the scene after it', async () => {
      const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('down'));
      const user = userEvent.setup();
      renderStage(createTestQueryClient());

      show3d();

      expect(await screen.findByText('The 3D view is not ready')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Campus 3D view' })).toHaveAttribute(
        'aria-busy',
        'false',
      );
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

      get.mockResolvedValue([]);
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    });

    it('draws the 3D stage in place of the map, with the tools still over it', async () => {
      renderStage();
      // The first render was the 2D map; what matters is that it is not drawn again in 3D.
      vi.mocked(CampusMap).mockClear();

      show3d();

      expect(await screen.findByText('3D stage')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Campus 3D view' })).toBeInTheDocument();
      expect(CampusMap).not.toHaveBeenCalled();
      expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
    });

    it('offers Incidents, Cameras and Heat only while the 3D stage shows, and Assets again in 2D', async () => {
      renderStage();

      show3d();
      await screen.findByText('3D stage');
      const layers = screen.getByRole('group', { name: 'Layers' });
      expect(
        within(layers)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Incidents', 'Cameras', 'Heat']);

      act(() => useConsole.setState({ view: '2d' }));

      expect(
        within(screen.getByRole('group', { name: 'Layers' })).getByRole('button', {
          name: 'Assets',
        }),
      ).toBeInTheDocument();
    });

    // V2-17.4 (frame 13): the picker stands in the tools row, after the layers, and only while Heat is drawn.
    it('draws the "Colour by" picker after the layers while Heat is on, and not before', async () => {
      renderStage();
      show3d();
      await screen.findByText('3D stage');
      expect(screen.queryByRole('button', { name: /Colour by/ })).toBeNull();

      act(() => useConsole.getState().toggleLayer('heat'));

      const picker = screen.getByRole('button', { name: 'Colour by Indoor temperature' });
      const layers = screen.getByRole('group', { name: 'Layers' });
      const follows = layers.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(follows).toBeTruthy();

      act(() => useConsole.getState().toggleLayer('heat'));

      expect(screen.queryByRole('button', { name: /Colour by/ })).toBeNull();
    });

    it('does not draw the picker in the 2D view, whatever Heat says', async () => {
      renderStage();
      show3d();
      await screen.findByText('3D stage');
      act(() => useConsole.getState().toggleLayer('heat'));
      expect(screen.getByRole('button', { name: /Colour by/ })).toBeInTheDocument();

      act(() => useConsole.setState({ view: '2d' }));

      expect(screen.queryByRole('button', { name: /Colour by/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Heat' })).toBeNull();
    });

    it('puts the map back when the context is lost, with the switch still there', async () => {
      renderStage();
      show3d();
      await screen.findByText('3D stage');
      vi.mocked(CampusMap).mockClear();

      act(() => useConsole.getState().markTwinLost());

      expect(CampusMap).toHaveBeenCalled();
      expect(screen.queryByText('3D stage')).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
    });

    // The fault is the session's, not the operator's choice: the stored `3d` stays, so a reload tries 3D again,
    // and the switch says why the 3D option is off.
    it('keeps the stored choice on a fault, and says why 3D is off', async () => {
      // jsdom has no WebGL 2; stub it, so the reason shown is the fault and not `no-webgl2`.
      stubTwinAvailable();
      localStorage.setItem('occ.console.view', '3d');
      renderStage();
      show3d();
      await screen.findByText('3D stage');

      act(() => useConsole.getState().markTwinLost());

      expect(localStorage.getItem('occ.console.view')).toBe('3d');
      expect(screen.getByRole('button', { name: '3D' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('button', { name: '3D' })).toHaveAccessibleDescription(
        TWIN_UNAVAILABLE_COPY['context-lost'].title,
      );
    });

    it('mounts the map again when the view goes back to 2D', async () => {
      renderStage();
      show3d();
      await screen.findByText('3D stage');
      vi.mocked(CampusMap).mockClear();

      act(() => useConsole.setState({ view: '2d' }));

      expect(CampusMap).toHaveBeenCalled();
      expect(screen.queryByText('3D stage')).not.toBeInTheDocument();
    });

    // V2-15.6, frames 03, 12 and 15: the scene's breadcrumb is in the 3D / 2D switch's place at building and
    // asset level, and the layers stay.
    describe('the breadcrumb', () => {
      it('takes the place of the view switch at building level, with the layers still there', async () => {
        renderStage(clientWithBuilding());
        show3d();
        await screen.findByText('3D stage');

        act(() => useConsole.getState().focusBuilding('z-dc'));

        expect(crumbsNav()).toBeInTheDocument();
        expect(within(crumbsNav()!).getByText('Data Center')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
      });

      it('does so at asset level too', async () => {
        renderStage(clientWithBuilding());
        show3d();
        await screen.findByText('3D stage');

        act(() => useConsole.getState().selectAsset('CT-01', 'z-dc'));

        expect(crumbsNav()).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
      });

      it('is absent at campus level, where the switch is', async () => {
        renderStage(clientWithBuilding());
        show3d();
        await screen.findByText('3D stage');

        expect(crumbsNav()).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
      });

      it('gives the switch back when its back button goes up to the campus', async () => {
        renderStage(clientWithBuilding());
        show3d();
        await screen.findByText('3D stage');
        act(() => useConsole.getState().focusBuilding('z-dc'));

        await userEvent.click(screen.getByRole('button', { name: 'Up one level — Campus' }));

        expect(crumbsNav()).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
      });

      it('never replaces the switch in the 2D view, where there are no levels', () => {
        renderStage(clientWithBuilding());

        act(() => useConsole.getState().focusBuilding('z-dc'));

        expect(crumbsNav()).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
      });

      it('lets the switch come back when the context is lost at a level', async () => {
        renderStage(clientWithBuilding());
        show3d();
        await screen.findByText('3D stage');
        act(() => useConsole.getState().focusBuilding('z-dc'));

        act(() => useConsole.getState().markTwinLost());

        expect(crumbsNav()).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
      });
    });
  });
});

// V2-21.6: the video wall mounts the same lazy stage, through the same import, with nothing to press.
describe('LazyTwinStage on a video wall', () => {
  beforeEach(() => {
    resetStore(useConsole);
    twin.fail = false;
    twin.crash = false;
  });
  afterEach(() => {
    twin.crash = false;
    vi.restoreAllMocks();
  });

  it('hands the stage `wall`, in a region named for the 3D view', async () => {
    renderWithQueryClient(<LazyTwinStage wall />, seededClient());

    expect(await screen.findByText('3D stage (wall)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Campus 3D view/ })).toBeInTheDocument();
  });

  it('shows the loading card with no Retry when the site plan fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('down'));
    renderWithQueryClient(<LazyTwinStage wall />, createTestQueryClient());

    expect(await screen.findByText('The 3D view is not ready')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the stage stopped working with no Retry to press', async () => {
    twin.crash = true;
    // The boundary logs the failure, as it does for any region that breaks.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithQueryClient(<LazyTwinStage wall />, seededClient());

    expect(await screen.findByText('The 3D view stopped working.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Campus 3D view' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

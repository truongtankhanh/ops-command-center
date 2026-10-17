import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { CampusMap } from './CampusMap';
import { StageView } from './StageView';

// MapLibre needs WebGL, which jsdom does not have; the map's own tests cover the map.
vi.mock('./CampusMap', () => ({ CampusMap: vi.fn(() => null) }));

// The 3D chunk, stood in for: R3F needs WebGL too. A mock factory runs when the module is first
// imported, so `twin.evaluated` says whether anything asked for the chunk, and `twin.fail` makes
// that import fail (a chunk that cannot be fetched).
const twin = vi.hoisted(() => ({ evaluated: 0, fail: false }));
vi.mock('../twin/TwinStage', () => {
  twin.evaluated += 1;
  if (twin.fail) throw new Error('chunk failed to load');
  return { default: () => <div>3D stage</div> };
});

const show3d = () => act(() => useConsole.setState({ view: '3d' }));

describe('StageView', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
    vi.mocked(CampusMap).mockClear();
    twin.evaluated = 0;
    twin.fail = false;
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

  // The preview gate is closed under Vitest (V2-12.4), so the store never holds `3d` here (see `effectiveView`): what is stored cannot change
  // what is drawn: the stage keeps showing the map and the switch shows 2D pressed.
  it('still draws the map when a 3D choice was stored by a later build', () => {
    localStorage.setItem('occ.console.view', '3d');

    render(<StageView />);

    expect(CampusMap).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('occ.console.view')).toBe('3d');
  });
  // These cases are in order on purpose: the module registry keeps a chunk that loaded, so the case
  // that needs it not to have been loaded yet comes first.
  describe('the 3D branch', () => {
    it('does not ask for the 3D chunk while the 2D map is shown', () => {
      render(<StageView />);

      expect(twin.evaluated).toBe(0);
    });

    it('keeps the switch and the 2D choice when the chunk cannot be loaded, and Retry tries again', async () => {
      const user = userEvent.setup();
      twin.fail = true;
      // The boundary logs the failure, as it does for any region that breaks.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      render(<StageView />);

      show3d();

      expect(await screen.findByText('The 3D view stopped working.')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();

      twin.fail = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('3D stage')).toBeInTheDocument();
      logged.mockRestore();
    });

    it('draws the 3D stage in place of the map, with the tools still over it', async () => {
      render(<StageView />);
      // The first render was the 2D map; what matters is that it is not drawn again in 3D.
      vi.mocked(CampusMap).mockClear();

      show3d();

      expect(await screen.findByText('3D stage')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Campus 3D view' })).toBeInTheDocument();
      expect(CampusMap).not.toHaveBeenCalled();
      expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
    });

    it('offers Incidents and Cameras only while the 3D stage shows, and Assets again in 2D', async () => {
      render(<StageView />);

      show3d();
      await screen.findByText('3D stage');
      const layers = screen.getByRole('group', { name: 'Layers' });
      expect(
        within(layers)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Incidents', 'Cameras']);

      act(() => useConsole.setState({ view: '2d' }));

      expect(
        within(screen.getByRole('group', { name: 'Layers' })).getByRole('button', {
          name: 'Assets',
        }),
      ).toBeInTheDocument();
    });

    it('puts the map back when the context is lost, with the switch still there', async () => {
      render(<StageView />);
      show3d();
      await screen.findByText('3D stage');
      vi.mocked(CampusMap).mockClear();

      act(() => useConsole.getState().markTwinLost());

      expect(CampusMap).toHaveBeenCalled();
      expect(screen.queryByText('3D stage')).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
    });

    it('mounts the map again when the view goes back to 2D', async () => {
      render(<StageView />);
      show3d();
      await screen.findByText('3D stage');
      vi.mocked(CampusMap).mockClear();

      act(() => useConsole.setState({ view: '2d' }));

      expect(CampusMap).toHaveBeenCalled();
      expect(screen.queryByText('3D stage')).not.toBeInTheDocument();
    });
  });
});

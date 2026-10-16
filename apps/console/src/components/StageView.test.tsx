import { render, screen } from '@testing-library/react';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { CampusMap } from './CampusMap';
import { StageView } from './StageView';

// MapLibre needs WebGL, which jsdom does not have; the map's own tests cover the map.
vi.mock('./CampusMap', () => ({ CampusMap: vi.fn(() => null) }));

describe('StageView', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
    vi.mocked(CampusMap).mockClear();
  });

  it('draws the 2D map with the view switch over it', () => {
    render(<StageView />);

    expect(CampusMap).toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
  });

  // Until V2-12 the store never holds `3d` (see `effectiveView`), so what is stored cannot change
  // what is drawn: the stage keeps showing the map and the switch shows 2D pressed.
  it('still draws the map when a 3D choice was stored by a later build', () => {
    localStorage.setItem('occ.console.view', '3d');

    render(<StageView />);

    expect(CampusMap).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('occ.console.view')).toBe('3d');
  });
});

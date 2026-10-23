import { act, screen } from '@testing-library/react';
import { useConsole } from '../../store';
import {
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from '../../test-utils';
import { WallStage } from './WallStage';

// MapLibre is the map's own tests'; the stand-ins say whether the wall asked for the wall variant.
vi.mock('../map/CampusMap', () => ({
  CampusMap: ({ wall }: { wall?: boolean }) => (
    <section aria-label="Campus map">{wall ? '2D map (wall)' : '2D map'}</section>
  ),
}));
vi.mock('../../twin/TwinStage', () => ({
  default: ({ wall }: { wall?: boolean }) => <p>{wall ? '3D stage (wall)' : '3D stage'}</p>,
}));

describe('WallStage', () => {
  beforeEach(() => resetStore(useConsole));
  afterEach(unstubTwin);

  describe('where 3D can be drawn', () => {
    it('shows the twin in its wall variant and no tag', async () => {
      stubTwinAvailable();

      renderWithQueryClient(<WallStage />);

      expect(await screen.findByText('3D stage (wall)')).toBeInTheDocument();
      expect(screen.queryByText('2D map (wall)')).toBeNull();
      expect(screen.queryByText(/^2D map —/)).toBeNull();
    });

    it('does not follow the 2D choice an operator stored in the same browser', async () => {
      stubTwinAvailable();
      useConsole.setState({ view: '2d' });

      renderWithQueryClient(<WallStage />);

      expect(await screen.findByText('3D stage (wall)')).toBeInTheDocument();
    });
  });

  describe('where it cannot', () => {
    it('shows the wall’s map and a tag with the reason, with nothing to press', async () => {
      const { container } = renderWithQueryClient(<WallStage />);

      expect(screen.getByText('2D map (wall)')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        "2D map — 3D view isn't available on this device",
      );
      expect(screen.queryByText('3D stage (wall)')).toBeNull();
      expect(container.querySelectorAll('button, a[href], input, [tabindex]')).toHaveLength(0);
      await expectNoAxeViolations(container);
    });

    it('swaps the twin for the map when the context is lost, and says so', async () => {
      stubTwinAvailable();
      renderWithQueryClient(<WallStage />);
      expect(await screen.findByText('3D stage (wall)')).toBeInTheDocument();

      act(() => useConsole.getState().markTwinLost());

      expect(await screen.findByText('2D map (wall)')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('2D map — 3D view stopped working');
    });

    it('says when the 3D view was too slow', async () => {
      stubTwinAvailable();
      renderWithQueryClient(<WallStage />);
      expect(await screen.findByText('3D stage (wall)')).toBeInTheDocument();

      act(() => useConsole.getState().markTwinLost('too-slow'));

      expect(screen.getByRole('status')).toHaveTextContent('2D map — 3D view was too slow');
    });

    it('does not come back to 3D by itself', async () => {
      stubTwinAvailable();
      renderWithQueryClient(<WallStage />);
      act(() => useConsole.getState().markTwinLost());
      expect(await screen.findByText('2D map (wall)')).toBeInTheDocument();

      // Time passes and the device still could draw it: a wall retries only by reloading (V2-21.10).
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      expect(screen.getByText('2D map (wall)')).toBeInTheDocument();
    });
  });
});

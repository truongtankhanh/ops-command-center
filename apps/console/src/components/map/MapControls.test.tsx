import type { Map as MapLibreMap } from 'maplibre-gl';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../test-utils';
import { MapControls } from './MapControls';

const MIN_ZOOM = 15;
const MAX_ZOOM = 20;

/** The calls `MapControls` makes: the zoom and its limits, the two zoom commands, and subscribing to the zoom change. */
function fakeMap(initialZoom = 17) {
  const handlers = new Set<() => void>();
  let zoom = initialZoom;
  const map = {
    getZoom: vi.fn(() => zoom),
    getMinZoom: vi.fn(() => MIN_ZOOM),
    getMaxZoom: vi.fn(() => MAX_ZOOM),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'zoom') handlers.add(handler);
    }),
    off: vi.fn((event: string, handler: () => void) => {
      if (event === 'zoom') handlers.delete(handler);
    }),
  };
  return {
    map,
    asMap: map as unknown as MapLibreMap,
    handlers,
    /** MapLibre fires `zoom` on every animation frame; the handler reads the zoom then. */
    setZoom(next: number) {
      zoom = next;
      act(() => handlers.forEach((handler) => handler()));
    },
  };
}

const zoomIn = () => screen.getByRole('button', { name: 'Zoom in' });
const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' });
const fit = () => screen.getByRole('button', { name: 'Fit campus' });

describe('MapControls', () => {
  it('is one group named "Map view" with Zoom in, Zoom out and Fit campus, in that order', () => {
    render(<MapControls map={fakeMap().asMap} onFit={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Map view' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Zoom in', 'Zoom out', 'Fit campus']);
  });

  // V3-10.5: the surface is the Panel's, so the controls are one floating panel (the 3D view's rail has the same look).
  it('is one floating panel holding the group', () => {
    render(<MapControls map={fakeMap().asMap} onFit={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Map view' });
    expect(group).toHaveAttribute('data-variant', 'floating');
    expect(group).toContainElement(zoomIn());
    expect(group).toContainElement(zoomOut());
    expect(group).toContainElement(fit());
  });

  it('zooms the map in and out, and fits the campus through the caller', async () => {
    const { map, asMap } = fakeMap();
    const onFit = vi.fn();
    render(<MapControls map={asMap} onFit={onFit} />);

    await userEvent.click(zoomIn());
    await userEvent.click(zoomOut());
    await userEvent.click(fit());

    expect(map.zoomIn).toHaveBeenCalledTimes(1);
    expect(map.zoomOut).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledTimes(1);
  });

  it('starts with every button available', () => {
    render(<MapControls map={fakeMap().asMap} onFit={vi.fn()} />);

    for (const button of [zoomIn(), zoomOut(), fit()]) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled');
    }
  });

  describe('at a zoom limit', () => {
    it('marks Zoom in aria-disabled, not disabled, at the maximum, and Zoom out at the minimum', () => {
      const fake = fakeMap();
      render(<MapControls map={fake.asMap} onFit={vi.fn()} />);

      fake.setZoom(MAX_ZOOM);
      expect(zoomIn()).toHaveAttribute('aria-disabled', 'true');
      expect(zoomIn()).toBeEnabled();
      expect(zoomOut()).not.toHaveAttribute('aria-disabled');

      fake.setZoom(MIN_ZOOM);
      expect(zoomOut()).toHaveAttribute('aria-disabled', 'true');
      expect(zoomOut()).toBeEnabled();
      expect(zoomIn()).not.toHaveAttribute('aria-disabled');
    });

    it('keeps keyboard focus on the button that reached the limit', () => {
      const fake = fakeMap(MAX_ZOOM - 1);
      render(<MapControls map={fake.asMap} onFit={vi.fn()} />);
      zoomIn().focus();

      fake.setZoom(MAX_ZOOM);

      expect(zoomIn()).toHaveFocus();
    });

    it('lets the map clamp a press at the limit, since the button still takes the click', async () => {
      const fake = fakeMap(MAX_ZOOM);
      render(<MapControls map={fake.asMap} onFit={vi.fn()} />);
      fake.setZoom(MAX_ZOOM);

      await userEvent.click(zoomIn());

      expect(fake.map.zoomIn).toHaveBeenCalledTimes(1);
    });

    it('clears the mark when the zoom moves back inside the limits', () => {
      const fake = fakeMap();
      render(<MapControls map={fake.asMap} onFit={vi.fn()} />);

      fake.setZoom(MAX_ZOOM);
      expect(zoomIn()).toHaveAttribute('aria-disabled', 'true');
      fake.setZoom(MAX_ZOOM - 1);

      expect(zoomIn()).not.toHaveAttribute('aria-disabled');
    });

    it('never marks Fit campus', () => {
      const fake = fakeMap();
      render(<MapControls map={fake.asMap} onFit={vi.fn()} />);

      fake.setZoom(MAX_ZOOM);
      expect(fit()).not.toHaveAttribute('aria-disabled');
      fake.setZoom(MIN_ZOOM);
      expect(fit()).not.toHaveAttribute('aria-disabled');
    });
  });

  it('disables every button while there is no map yet', () => {
    render(<MapControls map={null} onFit={vi.fn()} />);

    expect(zoomIn()).toBeDisabled();
    expect(zoomOut()).toBeDisabled();
    expect(fit()).toBeDisabled();
  });

  it('listens to the map’s zoom and lets go of it when it unmounts', () => {
    const fake = fakeMap();
    const { unmount } = render(<MapControls map={fake.asMap} onFit={vi.fn()} />);
    expect(fake.map.on).toHaveBeenCalledWith('zoom', expect.any(Function));
    expect(fake.handlers.size).toBe(1);

    unmount();

    expect(fake.handlers.size).toBe(0);
  });

  it('has no axe violations, at a limit or not', async () => {
    const fake = fakeMap();
    render(<MapControls map={fake.asMap} onFit={vi.fn()} />);
    await expectNoAxeViolations();

    fake.setZoom(MAX_ZOOM);
    await expectNoAxeViolations();
  });
});

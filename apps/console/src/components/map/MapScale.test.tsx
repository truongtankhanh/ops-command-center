import type { Map as MapLibreMap } from 'maplibre-gl';
import { render } from '@testing-library/react';
import { MapScale } from './MapScale';

const LATITUDE = 11.953;

/** A map with the three calls `MapScale` makes: the zoom, and subscribing to its change. */
function fakeMap(initialZoom: number) {
  const handlers = new Set<() => void>();
  let zoom = initialZoom;
  const map = {
    getZoom: vi.fn(() => zoom),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'zoom') handlers.add(handler);
    }),
    off: vi.fn((event: string, handler: () => void) => {
      if (event === 'zoom') handlers.delete(handler);
    }),
  };
  return {
    map: map as unknown as MapLibreMap,
    handlers,
    setZoom(next: number) {
      zoom = next;
      handlers.forEach((handler) => handler());
    },
  };
}

/** The bar's root: it is `aria-hidden`, so a role query cannot reach it. */
const rootOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const labelOf = (root: HTMLElement) => root.lastElementChild as HTMLElement;
const width = (root: HTMLElement) => root.style.getPropertyValue('--scale-bar-width');

describe('MapScale', () => {
  it('draws the round length that fits the zoom it finds on arrival', () => {
    const { map } = fakeMap(16.4);
    const { container } = render(<MapScale map={map} latitude={LATITUDE} />);
    const root = rootOf(container);

    // 0.8855 m a pixel: 100 m is 113 px of the 120 px it may have.
    expect(root).toHaveAttribute('data-ready');
    expect(labelOf(root)).toHaveTextContent('100 m');
    expect(width(root)).toBe('113px');
  });

  it('follows the zoom', () => {
    const view = fakeMap(16.4);
    const { container } = render(<MapScale map={view.map} latitude={LATITUDE} />);
    const root = rootOf(container);

    view.setZoom(18);
    expect(labelOf(root)).toHaveTextContent('20 m');
    expect(width(root)).toBe('68px');

    view.setZoom(15);
    expect(labelOf(root)).toHaveTextContent('200 m');
    expect(width(root)).toBe('86px');
  });

  it('keeps the label while the length is the same and moves only the bar', () => {
    const view = fakeMap(16.4);
    const { container } = render(<MapScale map={view.map} latitude={LATITUDE} />);
    const root = rootOf(container);
    const labelNode = labelOf(root).firstChild;

    view.setZoom(16.45);

    expect(labelOf(root)).toHaveTextContent('100 m');
    expect(labelOf(root).firstChild).toBe(labelNode);
    expect(width(root)).toBe('117px');
  });

  it('draws nothing until it has a map and a latitude', () => {
    const { container, rerender } = render(<MapScale map={null} latitude={LATITUDE} />);
    expect(rootOf(container)).not.toHaveAttribute('data-ready');

    const { map } = fakeMap(16.4);
    rerender(<MapScale map={map} latitude={undefined} />);
    expect(rootOf(container)).not.toHaveAttribute('data-ready');

    rerender(<MapScale map={map} latitude={LATITUDE} />);
    expect(rootOf(container)).toHaveAttribute('data-ready');
  });

  it('hides the bar again when the map goes away', () => {
    const { map } = fakeMap(16.4);
    const { container, rerender } = render(<MapScale map={map} latitude={LATITUDE} />);

    rerender(<MapScale map={null} latitude={LATITUDE} />);

    expect(rootOf(container)).not.toHaveAttribute('data-ready');
  });

  it('listens once, and stops listening on unmount and when the map changes', () => {
    const first = fakeMap(16.4);
    const second = fakeMap(18);
    const { rerender, unmount } = render(<MapScale map={first.map} latitude={LATITUDE} />);
    expect(first.handlers.size).toBe(1);

    rerender(<MapScale map={second.map} latitude={LATITUDE} />);
    expect(first.handlers.size).toBe(0);
    expect(second.handlers.size).toBe(1);

    unmount();
    expect(second.handlers.size).toBe(0);
  });

  it('takes a class from the caller and is hidden from assistive technology', () => {
    const { map } = fakeMap(16.4);
    const { container } = render(<MapScale map={map} latitude={LATITUDE} className="placed" />);

    expect(rootOf(container)).toHaveClass('placed');
    expect(rootOf(container)).toHaveAttribute('aria-hidden', 'true');
  });
});

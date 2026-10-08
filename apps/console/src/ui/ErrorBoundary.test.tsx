import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegionFallback } from '../components/LoadStates';
import { ErrorBoundary } from './ErrorBoundary';

/** While set, `Feed` throws on every render: the fault the boundary has to contain. */
let broken = false;

function Feed() {
  if (broken) throw new Error('boom');
  return (
    <>
      <p>Feed content</p>
      <button type="button">Row</button>
    </>
  );
}

/** The boundary as the console places it around the feed, with the real fallback. */
function renderRegion() {
  return render(region());
}

function region() {
  return (
    <ErrorBoundary
      region="Incidents"
      fallback={(retry) => (
        <RegionFallback
          label="Incidents"
          message="The incident list stopped working."
          retry={retry}
        />
      )}
    >
      <Feed />
    </ErrorBoundary>
  );
}

/** The region next to something outside it that can hold focus. */
function renderRegionWithNeighbour() {
  const page = () => (
    <>
      {region()}
      <button type="button">Elsewhere</button>
    </>
  );
  const view = render(page());
  return { ...view, rerender: () => view.rerender(page()) };
}

const fallback = () => screen.queryByRole('region', { name: 'Incidents' });

describe('ErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    broken = false;
    // React reports a caught error there too; silenced so the run stays readable.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows its children while nothing breaks', () => {
    renderRegion();

    expect(screen.getByText('Feed content')).toBeInTheDocument();
    expect(fallback()).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('shows the fallback in place of a child that throws while rendering', () => {
    broken = true;

    renderRegion();

    expect(fallback()).toHaveTextContent('The incident list stopped working.');
    expect(screen.queryByText('Feed content')).toBeNull();
  });

  it("logs the error with the region's name", () => {
    broken = true;

    renderRegion();

    expect(consoleError).toHaveBeenCalledWith(
      'Incidents stopped working',
      expect.objectContaining({ message: 'boom' }),
      expect.any(String),
    );
  });

  it('starts the region again on Retry', async () => {
    broken = true;
    renderRegion();
    expect(fallback()).not.toBeNull();

    // The fault has cleared (e.g. the data that broke it changed): Retry mounts the region again.
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Feed content')).toBeInTheDocument();
    expect(fallback()).toBeNull();
  });

  // UI-16 Q7: focus that went with the broken region is not left on the page body.
  it('gives Retry the focus when the region that had it breaks', () => {
    const { rerender } = renderRegionWithNeighbour();
    act(() => screen.getByRole('button', { name: 'Row' }).focus());

    broken = true;
    rerender();

    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
  });

  it('leaves focus alone when it was outside the region', () => {
    const { rerender } = renderRegionWithNeighbour();
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());

    broken = true;
    rerender();

    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('falls back again when the region still breaks', async () => {
    broken = true;
    renderRegion();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(fallback()).toHaveTextContent('The incident list stopped working.');
    expect(screen.queryByText('Feed content')).toBeNull();
  });
});

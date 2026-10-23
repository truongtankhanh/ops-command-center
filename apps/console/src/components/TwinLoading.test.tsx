import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { twinLoadSteps } from '../lib/twin-core/twinLoading';
import { expectNoAxeViolations } from '../test-utils';
import { TwinLoading } from './TwinLoading';

const loading = twinLoadSteps({ codeLoaded: false, sitePlan: 'pending' });
const partway = twinLoadSteps({ codeLoaded: true, sitePlan: 'pending' });
const failed = twinLoadSteps({ codeLoaded: true, sitePlan: 'failed' });

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');

describe('TwinLoading', () => {
  it('says what it is: a title and the sentence about what already works', () => {
    render(<TwinLoading steps={loading} />);

    expect(screen.getByText('Loading the 3D view', { selector: 'strong' })).toBeInTheDocument();
    expect(
      screen.getByText('Incidents and cameras are in the feed and the 2D view.'),
    ).toBeInTheDocument();
  });

  it('lists the steps in order with what each comes from', () => {
    render(<TwinLoading steps={loading} />);

    expect(rows().map((row) => row.textContent)).toEqual([
      'Site plan, loadingfrom the API',
      '3D view code, loadingfrom this site',
    ]);
  });

  it('marks each step by its state, in an attribute and in a hidden word', () => {
    render(<TwinLoading steps={partway} />);

    expect(rows().map((row) => row.getAttribute('data-state'))).toEqual(['active', 'done']);
    expect(rows()[1]).toHaveTextContent('3D view code, done');
  });

  it('shows a progress bar that counts the steps done', () => {
    const { rerender } = render(<TwinLoading steps={loading} />);
    const bar = () => screen.getByRole('progressbar', { name: 'Loading the 3D view' });

    expect(bar()).toHaveAttribute('aria-valuemin', '0');
    expect(bar()).toHaveAttribute('aria-valuemax', '2');
    expect(bar()).toHaveAttribute('aria-valuenow', '0');

    rerender(<TwinLoading steps={partway} />);

    expect(bar()).toHaveAttribute('aria-valuenow', '1');
    expect(bar().firstElementChild).toHaveStyle({ width: '50%' });
  });

  // Announced once: the card is a status whose text is static, and the steps changing are not read again.
  it('is a status, and keeps its steps out of the live region', () => {
    render(<TwinLoading steps={loading} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'off');
  });

  it('keeps the same words in the card while a step finishes, so nothing is announced again', () => {
    const { rerender } = render(<TwinLoading steps={loading} />);
    const words = () => [
      screen.getByRole('status').querySelector('strong')?.textContent,
      screen.getByRole('status').querySelector('p')?.textContent,
    ];
    const before = words();

    rerender(<TwinLoading steps={partway} />);

    expect(words()).toEqual(before);
  });

  it('is not interactive while nothing failed: no Retry', () => {
    render(<TwinLoading steps={partway} onRetry={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('when a step failed', () => {
    it('says the 3D view is not ready, and which step failed', () => {
      render(<TwinLoading steps={failed} />);

      expect(
        screen.getByText('The 3D view is not ready', { selector: 'strong' }),
      ).toBeInTheDocument();
      expect(rows()[0]).toHaveAttribute('data-state', 'failed');
      expect(rows()[0]).toHaveTextContent('Site plan, failedcouldn’t load');
    });

    it('offers Retry beside it, which asks again', async () => {
      const onRetry = vi.fn();
      const user = userEvent.setup();
      render(<TwinLoading steps={failed} onRetry={onRetry} />);

      await user.click(within(rows()[0]!).getByRole('button', { name: 'Retry' }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows that it is asking, and cannot be pressed twice', () => {
      render(<TwinLoading steps={failed} onRetry={vi.fn()} retrying />);

      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('aria-busy', 'true');
    });

    it('has no Retry when it is given nothing to call', () => {
      render(<TwinLoading steps={failed} />);

      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  it('has no accessibility violations loading, partway and failed', async () => {
    const { rerender } = render(<TwinLoading steps={loading} />);
    await expectNoAxeViolations();

    rerender(<TwinLoading steps={partway} />);
    await expectNoAxeViolations();

    rerender(<TwinLoading steps={failed} onRetry={vi.fn()} />);
    await expectNoAxeViolations();
  });
});

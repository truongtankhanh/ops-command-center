import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../test-utils';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders its children', () => {
    render(<Pill>Live</Pill>);

    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('is neutral unless asked otherwise', () => {
    render(<Pill>Connecting…</Pill>);

    expect(screen.getByText('Connecting…')).toHaveAttribute('data-tone', 'neutral');
  });

  it.each(['signal', 'warning'] as const)('marks the %s tone', (tone) => {
    render(<Pill tone={tone}>Status</Pill>);

    expect(screen.getByText('Status')).toHaveAttribute('data-tone', tone);
  });

  it('keeps its tone when the caller passes a data attribute of the same name', () => {
    render(
      <Pill tone="signal" data-tone="warning">
        Live
      </Pill>,
    );

    expect(screen.getByText('Live')).toHaveAttribute('data-tone', 'signal');
  });

  it("keeps the caller's class for its placement", () => {
    render(<Pill className="pushed">Live</Pill>);

    expect(screen.getByText('Live')).toHaveClass('pushed');
  });

  it('passes other div attributes through, and leaves the live region to the caller', () => {
    render(
      <Pill tone="warning" data-state="offline" aria-label="Events link">
        <span role="status">Offline</span>
      </Pill>,
    );

    // The caller's own attribute stays on the same element as the tone, which is the status word's parent.
    const word = screen.getByRole('status');
    expect(word).toHaveTextContent('Offline');
    expect(word.parentElement).toHaveAttribute('data-state', 'offline');
    expect(word.parentElement).toHaveAttribute('data-tone', 'warning');
    expect(word.parentElement).toHaveAttribute('aria-label', 'Events link');
  });

  it('has no axe violations in any tone', async () => {
    render(
      <>
        <Pill>
          <span role="status">Connecting…</span>
        </Pill>
        <Pill tone="signal">
          <span role="status">Live</span>
        </Pill>
        <Pill tone="warning">
          <span role="status">Offline</span>
        </Pill>
      </>,
    );

    expect(screen.getAllByRole('status')).toHaveLength(3);
    await expectNoAxeViolations();
  });
});

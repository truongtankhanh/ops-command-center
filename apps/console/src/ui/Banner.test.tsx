import { render, screen } from '@testing-library/react';
import { Banner } from './Banner';
import { Lock } from './icons';

describe('Banner', () => {
  it('announces as an alert with its message and action', () => {
    const { container } = render(
      <Banner role="alert" icon={Lock} action={<button type="button">Sign in again</button>}>
        Your session has expired.
      </Banner>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your session has expired.');
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces politely as a status when asked', () => {
    render(<Banner role="status">Live updates paused</Banner>);

    expect(screen.getByRole('status')).toHaveTextContent('Live updates paused');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("keeps the caller's class for its placement", () => {
    render(
      <Banner role="status" className="top">
        Live updates paused
      </Banner>,
    );

    expect(screen.getByRole('status')).toHaveClass('top');
  });
});

import { render, screen, within } from '@testing-library/react';
import { expectNoAxeViolations } from '../test-utils';
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

  it('adds a second line inside the live element', () => {
    render(
      <Banner role="status" detail="This clears by itself.">
        Live updates paused
      </Banner>,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Live updates paused');
    expect(within(status).getByText('This clears by itself.')).toBeInTheDocument();
  });

  it('has no second line without one', () => {
    render(<Banner role="status">Live updates paused</Banner>);

    expect(screen.getByRole('status').textContent).toBe('Live updates paused');
  });

  it("keeps the caller's class for its placement", () => {
    render(
      <Banner role="status" className="top">
        Live updates paused
      </Banner>,
    );

    expect(screen.getByRole('status')).toHaveClass('top');
  });

  // UI-16: automated accessibility check of the fullest banner, as the session banner shows it.
  it('has no axe violations as an alert with a second line and an action', async () => {
    render(
      <Banner
        role="alert"
        icon={Lock}
        detail="Signing in again reloads the console."
        action={<button type="button">Sign in again</button>}
      >
        Your session has expired.
      </Banner>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired.');
    await expectNoAxeViolations();
  });
});

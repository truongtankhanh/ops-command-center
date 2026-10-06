import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { Plus } from './icons';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Save</Button>
      </form>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');

    await userEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits its form when given type="submit"', async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('marks no variant and no size for the default secondary, medium button', () => {
    render(<Button>Resolve</Button>);

    const button = screen.getByRole('button', { name: 'Resolve' });
    expect(button).not.toHaveAttribute('data-variant');
    expect(button).not.toHaveAttribute('data-size');
  });

  it.each(['primary', 'ghost', 'danger'] as const)('marks the %s variant', (variant) => {
    render(<Button variant={variant}>Go</Button>);

    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('data-variant', variant);
  });

  it('marks the small size', () => {
    render(<Button size="sm">Sign out</Button>);

    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveAttribute('data-size', 'sm');
  });

  it('is disabled and busy while loading, keeping the label it is given', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Reporting…
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Reporting…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not busy when not loading', () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('stays disabled when the caller disables it', () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the visible label as the name when it has an icon', () => {
    const { container } = render(<Button icon={Plus}>Report incident</Button>);

    expect(screen.getByRole('button', { name: 'Report incident' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it("passes native props through and keeps the caller's class", async () => {
    const onClick = vi.fn();
    render(
      <Button className="grow" aria-expanded={false} aria-controls="panel" onClick={onClick}>
        Open
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Open' });
    expect(button).toHaveClass('grow');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'panel');

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows a key hint and announces the shortcut, keeping the visible label as the name', () => {
    render(<Button shortcut="N">Report incident</Button>);

    expect(screen.getByRole('button', { name: 'Report incident' })).toHaveAttribute(
      'aria-keyshortcuts',
      'N',
    );
    expect(screen.getByText('N')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no hint and announces no shortcut by default', () => {
    const { container } = render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-keyshortcuts');
    // `kbd` has no ARIA role, so a selector is the only way to look for it.
    expect(container.querySelector('kbd')).toBeNull();
  });
});

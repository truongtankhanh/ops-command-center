import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ZoneGroup } from '../../lib/incidents/groupByZone';
import { expectNoAxeViolations } from '../../test-utils';
import { ZoneGroupRow } from './ZoneGroupRow';

const group = (overrides: Partial<ZoneGroup> = {}): ZoneGroup => ({
  zoneId: 'z-lab',
  name: 'Science Lab',
  count: 4,
  open: 3,
  worst: 'critical',
  newestAt: Date.parse('2026-10-01T12:00:00.000Z'),
  incidents: [],
  ...overrides,
});

describe('ZoneGroupRow', () => {
  it('is a button named by the zone, the count, the worst severity and how many are open', () => {
    render(<ZoneGroupRow group={group()} expanded={false} onToggle={() => undefined} />);

    expect(
      screen.getByRole('button', { name: 'Science Lab, 4 incidents, worst Critical, 3 open' }),
    ).toBeInTheDocument();
  });

  it('says "1 incident" for a group of one', () => {
    render(
      <ZoneGroupRow
        group={group({ count: 1, open: 1, worst: 'low' })}
        expanded={false}
        onToggle={() => undefined}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Science Lab, 1 incident, worst Low, 1 open' }),
    ).toBeInTheDocument();
  });

  it('starts its name with the visible zone name', () => {
    render(<ZoneGroupRow group={group()} expanded={false} onToggle={() => undefined} />);

    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/^Science Lab, /);
    expect(screen.getByRole('button')).toHaveTextContent('Science Lab');
  });

  it('draws the worst severity in words, the count and the open number', () => {
    render(<ZoneGroupRow group={group()} expanded={false} onToggle={() => undefined} />);

    const row = screen.getByRole('button');
    expect(row).toHaveTextContent('Worst: Critical · 3 open');
    expect(row).toHaveTextContent('4');
    expect(row).toHaveAttribute('data-severity', 'critical');
  });

  it.each([false, true])('says whether it is expanded (%s)', (expanded) => {
    render(<ZoneGroupRow group={group()} expanded={expanded} onToggle={() => undefined} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', String(expanded));
  });

  it('toggles on a click', async () => {
    const onToggle = vi.fn();
    render(<ZoneGroupRow group={group()} expanded={false} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it.each(['{Enter}', ' '])('toggles on the key %j', async (key) => {
    const onToggle = vi.fn();
    render(<ZoneGroupRow group={group()} expanded={false} onToggle={onToggle} />);
    screen.getByRole('button').focus();

    await userEvent.keyboard(key);

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('takes the roving tab index and the focus callback of the list', async () => {
    const onFocus = vi.fn();
    render(
      <ZoneGroupRow
        group={group()}
        expanded={false}
        onToggle={() => undefined}
        tabIndex={-1}
        onFocus={onFocus}
      />,
    );
    const row = screen.getByRole('button');

    expect(row).toHaveAttribute('tabindex', '-1');
    row.focus();
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it('has no axe violations, closed or open', async () => {
    const { rerender } = render(
      <ZoneGroupRow group={group()} expanded={false} onToggle={() => undefined} />,
    );
    await expectNoAxeViolations();

    rerender(<ZoneGroupRow group={group()} expanded onToggle={() => undefined} />);
    await expectNoAxeViolations();
  });
});

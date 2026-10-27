import type { Incident, IncidentSeverity } from '@occ/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../../api/queries';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { KpiTiles } from './KpiTiles';

const incident = (id: string, severity: IncidentSeverity): Incident => ({
  id,
  code: id.toUpperCase(),
  type: 'intrusion',
  title: `Incident ${id}`,
  description: null,
  zoneId: 'z1',
  position: [0, 0],
  source: 'operator',
  reportedAt: '2026-10-27T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  severity,
  status: 'open',
});

/** The list is seeded, so the tiles make no request. */
function renderTiles(incidents: Incident[], readOnly = false) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  return renderWithQueryClient(<KpiTiles readOnly={readOnly} />, client);
}

const tiles = () => screen.getAllByRole('button');

describe('KpiTiles', () => {
  beforeEach(() => resetStore(useConsole));

  it('draws four tiles, most severe first, each with its word and a decorative icon', () => {
    renderTiles([incident('h1', 'high'), incident('h2', 'high'), incident('l1', 'low')]);

    expect(tiles().map((tile) => tile.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '0 Critical',
      '2 High',
      '0 Medium',
      '1 Low',
    ]);
    for (const tile of tiles()) {
      expect(tile.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  // A zero count dims the count (CSS); the tile is still a toggle, so "Critical only" can be watched
  // before one arrives.
  it('marks a tile with nothing to count, and keeps it pressable', async () => {
    renderTiles([incident('h1', 'high')]);
    const [critical, high] = tiles();

    expect(critical).toHaveAttribute('data-zero', 'true');
    expect(high).toHaveAttribute('data-zero', 'false');

    await userEvent.click(critical!);
    expect(critical).toHaveAttribute('aria-pressed', 'true');
    expect(useConsole.getState().severity).toBe('critical');
  });

  it('presses one tile at a time and clears it on a second press', async () => {
    renderTiles([incident('h1', 'high'), incident('m1', 'medium')]);
    const [, high, medium] = tiles();

    await userEvent.click(high!);
    await userEvent.click(medium!);
    expect(high).toHaveAttribute('aria-pressed', 'false');
    expect(medium).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(medium!);
    expect(medium).toHaveAttribute('aria-pressed', 'false');
    expect(useConsole.getState().severity).toBeNull();
  });

  it('marks the critical tile hot only while a critical incident is active', () => {
    const { unmount } = renderTiles([incident('c1', 'critical'), incident('h1', 'high')]);
    const [critical, high] = tiles();
    expect(critical).toHaveAttribute('data-hot', 'true');
    expect(high).toHaveAttribute('data-hot', 'false');
    unmount();

    renderTiles([incident('h1', 'high')]);
    expect(tiles()[0]).toHaveAttribute('data-hot', 'false');
  });

  describe('read only', () => {
    it('draws the same four tiles as text: nothing to press', () => {
      renderTiles([incident('c1', 'critical')], true);

      expect(screen.queryAllByRole('button')).toHaveLength(0);
      const items = within(
        screen.getByRole('list', { name: 'Active incidents by severity' }),
      ).getAllByRole('listitem');
      expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        '1 Critical',
        '0 High',
        '0 Medium',
        '0 Low',
      ]);
    });

    it('marks each tile read only, keeps the zero and hot marks, and has no pressed state', () => {
      renderTiles([incident('c1', 'critical')], true);

      const tileOf = (item: HTMLElement) => item.firstElementChild;
      const items = screen.getAllByRole('listitem');
      for (const item of items) {
        expect(tileOf(item)).toHaveAttribute('data-readonly', 'true');
        expect(tileOf(item)).not.toHaveAttribute('aria-pressed');
      }
      expect(tileOf(items[0]!)).toHaveAttribute('data-hot', 'true');
      expect(tileOf(items[0]!)).toHaveAttribute('data-zero', 'false');
      expect(tileOf(items[1]!)).toHaveAttribute('data-zero', 'true');
    });
  });

  it.each([false, true])('has no axe violations (read only: %s)', async (readOnly) => {
    const { container } = renderTiles(
      [incident('c1', 'critical'), incident('h1', 'high')],
      readOnly,
    );

    await expectNoAxeViolations(container);
  });
});

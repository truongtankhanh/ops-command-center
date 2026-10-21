import type { Incident } from '@occ/contracts';
import { screen } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { WallApp } from './WallApp';

const incident = (id: string, status: Incident['status']): Incident => ({
  id,
  code: id.toUpperCase(),
  type: 'fire_alarm',
  severity: 'high',
  status,
  title: id,
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
});

function renderWall(incidents: Incident[] = []) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.cameras, []);
  return renderWithQueryClient(<WallApp screen={3} />, client);
}

describe('WallApp', () => {
  const width = window.innerWidth;

  beforeEach(() => {
    resetStore(useConsole);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1920,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: width,
    });
    document.documentElement.style.removeProperty('--ui-scale');
  });

  it('is one main named for its screen, under the header', () => {
    renderWall();

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main', { name: 'Video wall 3' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Wall 3 · view only');
  });

  it("has the stage's region and the side column's two parts, each named", () => {
    renderWall();

    expect(screen.getByRole('region', { name: 'Campus 3D view' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cameras — incident first' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Active incidents · / })).toBeInTheDocument();
  });

  it('counts the active incidents in the list heading by the feed’s rule', () => {
    renderWall([incident('a', 'open'), incident('b', 'acknowledged'), incident('c', 'resolved')]);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Active incidents · 2' }),
    ).toBeInTheDocument();
  });

  it('has nothing to press or tab to', () => {
    const { container } = renderWall([incident('a', 'open')]);

    expect(
      container.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]'),
    ).toHaveLength(0);
  });

  it("sets the wall's scale on <html> while it is mounted", () => {
    const { unmount } = renderWall();

    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.35');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('');
  });

  it('has no axe violations', async () => {
    renderWall([incident('a', 'open')]);

    await expectNoAxeViolations(document.body, { screen: true });
  });
});

import type { Incident, SitePlan } from '@occ/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import { expectNoAxeViolations, renderWithQueryClient, createTestQueryClient } from '../test-utils';
import type { HeatScene } from '../lib/twinHeat';
import { TwinView } from './TwinView';

const PLAN: SitePlan = {
  id: 'plan-1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: [108.4415, 11.953],
  features: [],
};

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'id',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/**
 * The view with the site's plan and incidents in the cache, as they are once the console has loaded;
 * `null` leaves one of them out of the cache, so its query is still on its way.
 */
function renderView({
  incidents = [],
  plan = PLAN,
  heat = null,
}: { incidents?: Incident[] | null; plan?: SitePlan | null; heat?: HeatScene | null } = {}) {
  const client = createTestQueryClient();
  if (plan) client.setQueryData(queryKeys.sitePlan, plan);
  if (incidents) client.setQueryData(queryKeys.incidents, incidents);
  return renderWithQueryClient(
    <TwinView heat={heat}>
      <p>the picture</p>
    </TwinView>,
    client,
  );
}

const group = () => screen.getByRole('group', { name: /^3D view of/ });

describe('TwinView', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is one focusable group, described as a 3D view, around what it is given', () => {
    renderView();

    expect(group()).toHaveAttribute('aria-roledescription', '3D view');
    expect(group()).toHaveAttribute('tabindex', '0');
    expect(group()).toHaveTextContent('the picture');
  });

  it('is named by the site and the active incidents, then points to the lists', () => {
    renderView({
      incidents: [
        incident({ id: 'a' }),
        incident({ id: 'b', status: 'acknowledged' }),
        incident({ id: 'c', status: 'resolved' }),
      ],
    });

    expect(group()).toHaveAccessibleName(
      '3D view of Langbiang Tech Campus with 2 active incidents. Drag to rotate. The incident list and the Assets tab list everything shown here.',
    );
  });

  it('says "1 active incident" for one and that there are none for none', () => {
    const { unmount } = renderView({ incidents: [incident({})] });
    expect(group()).toHaveAccessibleName(/with 1 active incident\. /);
    unmount();

    renderView({ incidents: [incident({ status: 'resolved' })] });
    expect(group()).toHaveAccessibleName(/with no active incidents\. /);
  });

  it('follows the cached incidents when an event changes them', async () => {
    const { client } = renderView({ incidents: [incident({ id: 'a' })] });
    expect(group()).toHaveAccessibleName(/with 1 active incident\. /);

    act(() => {
      client.setQueryData(queryKeys.incidents, [
        incident({ id: 'a' }),
        incident({ id: 'b', severity: 'critical' }),
      ]);
    });

    // TanStack Query tells its observers a tick later, which a synchronous `act` does not wait for.
    await waitFor(() => expect(group()).toHaveAccessibleName(/with 2 active incidents\. /));
  });

  it('leaves the count out while the incidents are on their way, instead of reading 0', () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));

    renderView({ incidents: null });

    expect(group()).toHaveAccessibleName(
      '3D view of Langbiang Tech Campus. Drag to rotate. The incident list and the Assets tab list everything shown here.',
    );
  });

  it('calls the site "the campus" while the plan is not there', () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));

    renderView({ incidents: [incident({})], plan: null });

    expect(group()).toHaveAccessibleName(/^3D view of the campus with 1 active incident\. /);
  });

  // The summary is read when the group takes focus; a live region would read a count that changed
  // while nobody asked.
  it('is not a live region', () => {
    const { container } = renderView({ incidents: [incident({})] });

    expect(group()).not.toHaveAttribute('aria-live');
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('has no axe violations', async () => {
    renderView({ incidents: [incident({})] });

    await expectNoAxeViolations();
  });

  describe('with the heat overlay (V2-17.3)', () => {
    /** The overlay of a campus whose silent buildings are `silentNames`; only the names are read here. */
    const overlay = (...silentNames: string[]): HeatScene => ({
      colours: new Map(),
      silent: new Set(),
      labels: new Map(),
      silentNames,
      alarmed: new Set(),
      key: silentNames.join(','),
    });
    const SCALE =
      'Campus coloured by indoor temperature per building, 19 to 27 °C; lighter is warmer.';

    it('says what the colours mean, between the incidents and the pointer', () => {
      renderView({ incidents: [incident({})], heat: overlay() });

      expect(group()).toHaveAccessibleName(
        `3D view of Langbiang Tech Campus with 1 active incident. ${SCALE} Drag to rotate. The incident list and the Assets tab list everything shown here.`,
      );
    });

    it('names the buildings that are faded because their sensor is silent', () => {
      renderView({ heat: overlay('Security Office') });

      expect(group()).toHaveAccessibleName(
        /Security Office faded: its sensor is silent\. Drag to rotate/,
      );
    });

    it('is the name it was without the overlay: nothing about colours', () => {
      renderView({ incidents: [incident({})], heat: null });

      expect(group()).not.toHaveAccessibleName(/coloured/);
    });

    it('follows the overlay as it comes and goes', () => {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.sitePlan, PLAN);
      client.setQueryData(queryKeys.incidents, []);
      const view = (heat: HeatScene | null) => (
        <TwinView heat={heat}>
          <p>the picture</p>
        </TwinView>
      );
      const { rerender } = renderWithQueryClient(view(null), client);
      expect(group()).not.toHaveAccessibleName(/coloured/);

      rerender(
        <QueryClientProvider client={client}>{view(overlay('Library'))}</QueryClientProvider>,
      );
      expect(group()).toHaveAccessibleName(/Library faded: its sensor is silent\./);

      rerender(<QueryClientProvider client={client}>{view(null)}</QueryClientProvider>);
      expect(group()).not.toHaveAccessibleName(/coloured/);
    });

    it('has no axe violations', async () => {
      renderView({ heat: overlay('Library', 'Security Office') });

      await expectNoAxeViolations();
    });
  });
});

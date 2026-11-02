import type { Incident, Role } from '@occ/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { useSession } from '../../auth/store';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { AssetTimeline } from './AssetTimeline';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const ASSET = { id: 'asset-ct-01' };
const HOUR_MS = 3_600_000;

/** Reported `hoursAgo` hours before the test started, so the age reads as whole hours. */
const incident = (id: string, hoursAgo: number, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: `Title of ${id}`,
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: ASSET.id,
  reportedAt: new Date(Date.now() - hoursAgo * HOUR_MS - 60_000).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Every request not answered from the cache: never settles, or fails with `status`. */
const hangRequests = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
const failRequests = (status = 500) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ statusCode: status, message: 'x' }), { status }),
      ),
    ),
  );

const HINT = 'Shows the incidents the console holds: up to the latest 200 on site.';

/** `incidents` undefined leaves the list unloaded (the request hangs or fails). */
function renderTimeline(incidents?: Incident[]) {
  const client = createTestQueryClient();
  if (incidents) client.setQueryData(queryKeys.incidents, incidents);
  return renderWithQueryClient(<AssetTimeline asset={ASSET} />, client);
}

function signInAs(role: Role) {
  useSession.getState().signedIn({ displayName: 'Signed-in user', roles: [role] });
}

const entries = () => screen.getAllByRole('listitem');

// The asset sheet's Timeline tab (V3-09.8): reading only, for every role.
describe('AssetTimeline', () => {
  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    signInAs('operator');
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    hangRequests();
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('what it lists', () => {
    it('lists the incidents of every status, newest first, whatever their severity', () => {
      renderTimeline([
        incident('old', 48, { severity: 'critical' }),
        incident('new', 1, { severity: 'low', status: 'resolved' }),
        incident('middle', 5, { status: 'acknowledged' }),
      ]);

      expect(entries().map((item) => within(item).getByText(/^INC-/).textContent)).toEqual([
        'INC-new',
        'INC-middle',
        'INC-old',
      ]);
    });

    it('leaves out another asset’s incidents and an operator’s', () => {
      renderTimeline([
        incident('mine', 1),
        incident('other', 2, { assetId: 'asset-ct-02' }),
        incident('operator', 3, { assetId: null, source: 'operator' }),
      ]);

      expect(screen.getByText('INC-mine')).toBeInTheDocument();
      expect(screen.queryByText('INC-other')).not.toBeInTheDocument();
      expect(screen.queryByText('INC-operator')).not.toBeInTheDocument();
    });

    it('reads one entry as its severity, type, when, status and code', () => {
      renderTimeline([incident('a', 3, { severity: 'critical', status: 'resolved' })]);

      // One name, in this order. The name trims each element, so the groups may run together
      // (`\s*`); the severity word is one text node, and the visible badge is hidden from it.
      const entry = screen.getByRole('button', { name: /^Critical severity,\s*Equipment fault/ });
      expect(entry).toHaveAccessibleName(/3h ago\s*Resolved\s*INC-a$/);
      expect(within(entry).getByText(/^\d{2}:\d{2}|\d{1,2} \w{3} \d{2}:\d{2}/)).toBeInTheDocument();
      expect(within(entry).getByText('3h ago', { exact: false })).toBeInTheDocument();
    });

    it('dates each entry for assistive tech', () => {
      const reported = incident('a', 3);
      renderTimeline([reported]);

      const time = within(screen.getByRole('button')).getByText('3h ago', { exact: false });
      expect(time.closest('time')).toHaveAttribute('dateTime', reported.reportedAt);
    });

    it('has no heading of its own: the tab names the panel', () => {
      renderTimeline([incident('a', 1)]);

      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });
  });

  describe('opening an entry', () => {
    it('selects that incident and clears the asset', async () => {
      useConsole.getState().selectAsset('CT-01', null);
      renderTimeline([incident('a', 1), incident('b', 2)]);

      await userEvent.click(screen.getByRole('button', { name: /INC-b$/ }));

      expect(useConsole.getState().selectedIncidentId).toBe('b');
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });
  });

  describe('the depth of the history', () => {
    it('says what it holds under the list', () => {
      renderTimeline([incident('a', 1)]);

      expect(screen.getByText(HINT)).toBeInTheDocument();
    });

    it('says it under the empty line too', () => {
      renderTimeline([incident('other', 1, { assetId: 'asset-ct-02' })]);

      expect(screen.getByText('No incidents have been raised by this asset.')).toBeInTheDocument();
      expect(screen.getByText(HINT)).toBeInTheDocument();
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
  });

  describe('a list that is not there yet', () => {
    it('is a skeleton with a loading status, and claims neither entries nor an empty history', () => {
      renderTimeline();

      expect(screen.getByRole('status')).toHaveTextContent('Loading incidents…');
      expect(screen.queryByText('No incidents have been raised by this asset.')).toBeNull();
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });

    it('says it could not be loaded, rather than that there is nothing', async () => {
      failRequests();
      renderTimeline();

      expect(await screen.findByText('Incidents could not be loaded.')).toBeInTheDocument();
      expect(screen.queryByText('No incidents have been raised by this asset.')).toBeNull();
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    });
  });

  describe('roles', () => {
    it.each<Role>(['viewer', 'technician', 'supervisor'])(
      'lists and opens an entry as a %s: nothing here is an action on the site',
      async (role) => {
        signInAs(role);
        renderTimeline([incident('a', 1)]);

        await userEvent.click(screen.getByRole('button', { name: /INC-a$/ }));

        expect(useConsole.getState().selectedIncidentId).toBe('a');
      },
    );
  });

  describe('accessibility', () => {
    it('has no axe violations with entries of every status', async () => {
      renderTimeline([
        incident('a', 1, { severity: 'critical' }),
        incident('b', 5, { status: 'acknowledged', severity: 'medium' }),
        incident('c', 30, { status: 'resolved', severity: 'low' }),
      ]);

      await expectNoAxeViolations();
    });

    it('has no axe violations when empty', async () => {
      renderTimeline([]);

      await expectNoAxeViolations();
    });

    it('has no axe violations while loading', async () => {
      renderTimeline();

      await expectNoAxeViolations();
    });
  });
});

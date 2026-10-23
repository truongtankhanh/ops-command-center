import type { Asset, IncidentDetail, Role } from '@occ/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { flyToSelection } from '../../lib/twin-core/twinFlight';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from '../../test-utils';
import { ShortcutHelp } from '../ShortcutHelp';
import { TwinShortcuts } from './TwinShortcuts';

// The flights themselves are `twinFlight.test.ts`'s: here only what each key asks for, and when.
vi.mock('../../lib/twin-core/twinFlight', () => ({ flyToSelection: vi.fn() }));

const asset = (id: string, code: string) => ({ id, code }) as Asset;
const ASSETS = [asset('asset-ct-01', 'CT-01'), asset('asset-lks-b3', 'LKS-B3')];

const incident = (overrides: Partial<IncidentDetail> = {}): IncidentDetail => ({
  id: 'incident-1',
  code: 'INC-000107',
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: 'asset-ct-01',
  reportedAt: '2026-10-16T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  timeline: [],
  ...overrides,
});

/** The keys beside a text field, where they must not run, and the help, a dialog that stops them at its root. */
function renderKeys(
  cached: IncidentDetail[] = [incident(), incident({ id: 'incident-2', assetId: null })],
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, ASSETS);
  for (const detail of cached) client.setQueryData(queryKeys.incident(detail.id), detail);
  return renderWithQueryClient(
    <>
      <input aria-label="Notes" />
      <TwinShortcuts />
      <ShortcutHelp />
    </>,
    client,
  );
}

const view = () => useConsole.getState().view;
const fly = vi.mocked(flyToSelection);

describe('TwinShortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    fly.mockClear();
    // A cached detail is stale at once: an unanswered request leaves it on screen.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => {
    unstubTwin();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('P', () => {
    it('switches the drag between Orbit and Pan, both ways, while 3D is available', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d' }));
      renderKeys();

      await userEvent.keyboard('p');
      expect(useConsole.getState().panTool).toBe(true);

      await userEvent.keyboard('p');
      expect(useConsole.getState().panTool).toBe(false);
    });

    it('does nothing where 3D is unavailable', async () => {
      renderKeys();

      await userEvent.keyboard('p');

      expect(useConsole.getState().panTool).toBe(false);
    });

    it('does nothing while single-key shortcuts are off', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d', keyboardShortcuts: false }));
      renderKeys();

      await userEvent.keyboard('p');

      expect(useConsole.getState().panTool).toBe(false);
    });

    it('is not typed into: a "p" in a text field only types', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d' }));
      renderKeys();

      await userEvent.type(screen.getByLabelText('Notes'), 'p');

      expect(screen.getByLabelText('Notes')).toHaveValue('p');
      expect(useConsole.getState().panTool).toBe(false);
    });
  });

  describe('V', () => {
    it('switches between 3D and 2D, both ways, while 3D is available', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d' }));
      renderKeys();

      await userEvent.keyboard('v');
      expect(view()).toBe('2d');

      await userEvent.keyboard('v');
      expect(view()).toBe('3d');
    });

    it('does nothing where 3D is unavailable', async () => {
      renderKeys();

      await userEvent.keyboard('v');

      expect(view()).toBe('2d');
    });

    it('does nothing while single-key shortcuts are off', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d', keyboardShortcuts: false }));
      renderKeys();

      await userEvent.keyboard('v');

      expect(view()).toBe('3d');
    });

    it('is not typed into: a "v" in a text field only types', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d' }));
      renderKeys();

      await userEvent.type(screen.getByLabelText('Notes'), 'v');

      expect(screen.getByLabelText('Notes')).toHaveValue('v');
      expect(view()).toBe('3d');
    });

    it('ignores a modifier, a repeat and an IME composition', () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d' }));
      renderKeys();

      fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 'v', metaKey: true });
      fireEvent.keyDown(document.body, { key: 'v', altKey: true });
      fireEvent.keyDown(document.body, { key: 'v', repeat: true });
      fireEvent.keyDown(document.body, { key: 'v', isComposing: true });

      expect(view()).toBe('3d');
    });

    it('does nothing while a dialog is open', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d' }));
      renderKeys();
      act(() => useConsole.getState().openShortcutHelp());

      await userEvent.keyboard('v');

      expect(view()).toBe('3d');
    });

    it('is honoured while the report form is picking a place, which carries over to the map', async () => {
      stubTwinAvailable();
      act(() => useConsole.setState({ view: '3d', reporting: true, picking: true }));
      renderKeys();

      await userEvent.keyboard('v');

      expect(view()).toBe('2d');
      expect(useConsole.getState().picking).toBe(true);
    });
  });

  describe('F', () => {
    it('does nothing with nothing selected', async () => {
      stubTwinAvailable();
      renderKeys();

      await userEvent.keyboard('f');

      expect(fly).not.toHaveBeenCalled();
      expect(view()).toBe('2d');
    });

    it('flies to the selected asset', async () => {
      stubTwinAvailable();
      act(() => useConsole.getState().selectAsset('LKS-B3', null));
      renderKeys();

      await userEvent.keyboard('f');

      expect(fly).toHaveBeenCalledExactlyOnceWith({ kind: 'asset', assetCode: 'LKS-B3' });
    });

    it('flies to the selected part, before the asset', async () => {
      stubTwinAvailable();
      act(() => {
        useConsole.getState().selectAsset('LKS-B3', null);
        useConsole.getState().selectPart('Fan');
      });
      renderKeys();

      await userEvent.keyboard('f');

      expect(fly).toHaveBeenCalledExactlyOnceWith({
        kind: 'part',
        assetCode: 'LKS-B3',
        part: 'Fan',
      });
    });

    it("frames the selected incident's asset", async () => {
      stubTwinAvailable();
      act(() => useConsole.getState().select('incident-1'));
      renderKeys();

      await userEvent.keyboard('f');

      expect(fly).toHaveBeenCalledExactlyOnceWith({ kind: 'incident-asset', assetCode: 'CT-01' });
    });

    it('flies to the beacon of an incident with no asset', async () => {
      stubTwinAvailable();
      act(() => useConsole.getState().select('incident-2'));
      renderKeys();

      await userEvent.keyboard('f');

      expect(fly).toHaveBeenCalledExactlyOnceWith({ kind: 'incident', incidentId: 'incident-2' });
    });

    it('follows the selection as it changes', async () => {
      stubTwinAvailable();
      renderKeys();

      act(() => useConsole.getState().selectAsset('LKS-B3', null));
      await userEvent.keyboard('f');
      act(() => useConsole.getState().select('incident-2'));
      await userEvent.keyboard('f');
      act(() => useConsole.getState().select(null));
      await userEvent.keyboard('f');

      expect(fly.mock.calls.map(([target]) => target.kind)).toEqual(['asset', 'incident']);
    });

    it('does nothing where 3D is unavailable', async () => {
      act(() => useConsole.getState().selectAsset('LKS-B3', null));
      renderKeys();

      await userEvent.keyboard('f');

      expect(fly).not.toHaveBeenCalled();
    });

    it('does nothing while single-key shortcuts are off', async () => {
      stubTwinAvailable();
      act(() => {
        useConsole.getState().selectAsset('LKS-B3', null);
        useConsole.setState({ keyboardShortcuts: false });
      });
      renderKeys();

      await userEvent.keyboard('f');

      expect(fly).not.toHaveBeenCalled();
    });

    it('is not typed into: an "f" in a text field only types', async () => {
      stubTwinAvailable();
      act(() => useConsole.getState().selectAsset('LKS-B3', null));
      renderKeys();

      await userEvent.type(screen.getByLabelText('Notes'), 'f');

      expect(screen.getByLabelText('Notes')).toHaveValue('f');
      expect(fly).not.toHaveBeenCalled();
    });

    it('ignores a modifier, a repeat and an IME composition, and a dialog', async () => {
      stubTwinAvailable();
      act(() => useConsole.getState().selectAsset('LKS-B3', null));
      renderKeys();

      fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 'f', repeat: true });
      fireEvent.keyDown(document.body, { key: 'f', isComposing: true });
      act(() => useConsole.getState().openShortcutHelp());
      await userEvent.keyboard('f');

      expect(fly).not.toHaveBeenCalled();
    });

    it.each<Role>(['operator', 'supervisor', 'technician', 'viewer'])(
      'is the same for a %s, since it only reads',
      async (role) => {
        stubTwinAvailable();
        act(() => {
          useSession.getState().signedIn({ displayName: 'Someone', roles: [role] });
          useConsole.getState().selectAsset('LKS-B3', null);
        });
        renderKeys();

        await userEvent.keyboard('f');

        expect(fly).toHaveBeenCalledExactlyOnceWith({ kind: 'asset', assetCode: 'LKS-B3' });
      },
    );
  });

  it('does not add its key listeners again when it renders again with the same selection', () => {
    stubTwinAvailable();
    act(() => useConsole.getState().selectAsset('LKS-B3', null));
    const added = vi.spyOn(window, 'addEventListener');
    const { rerender, client } = renderKeys();
    const keydowns = () => added.mock.calls.filter(([type]) => type === 'keydown').length;
    const afterMount = keydowns();

    rerender(
      <QueryClientProvider client={client}>
        <input aria-label="Notes" />
        <TwinShortcuts />
        <ShortcutHelp />
      </QueryClientProvider>,
    );

    expect(afterMount).toBeGreaterThan(0);
    expect(keydowns()).toBe(afterMount);
  });
});

import type {
  AssetDetail,
  IncidentDetail as Detail,
  TelemetryPoint,
  TelemetryRule,
  Zone,
} from '@occ/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { useSession } from '../../auth/store';
import { flyToSelection } from '../../lib/twin-core/twinFlight';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from '../../test-utils';
import { SheetHost } from '../../ui/Sheet';
import { AssetInspector } from '../assets/AssetInspector';
import { IncidentDetail } from '../incidents/IncidentDetail';
import { TwinShortcuts } from '../stage/TwinShortcuts';

/*
 * What no single tab's spec owns (V3-09.11): the behaviour of the inspector sheet **across** its tabs
 * and across its two contents, the incident's and the asset's. Each tab's content is the spec of
 * its component; the keys' own rules are `IncidentDetail.test.tsx`'s and `TwinShortcuts.test.tsx`'s.
 * Here the sheet is mounted as `App` mounts it (a `SheetHost` over the one selected content, with
 * the always-mounted `TwinShortcuts` that owns `F`), and every case is a keyboard or focus fact.
 * Assertions use roles, text and attributes only (ADR-0016).
 */

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));
// The flights are `twinFlight.test.ts`'s: here only what `F` asks for, and when.
vi.mock('../../lib/twin-core/twinFlight', () => ({ flyToSelection: vi.fn() }));

const NOTE_LABEL = 'Note for the timeline (optional)';
const NOTE_KEPT = 'Esc keeps your note. Close discards it.';
const SUBJECT = 'f3b1c2d4-5e6f-4a1b-9c8d-7e6f5a4b3c2d';

const zone: Zone = {
  id: 'zone-dc',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  polygon: [],
  center: [108.44, 11.95],
};

/** The only point: headline and ruled, so the Telemetry tab has no "All points" disclosure. */
const MOTOR: TelemetryPoint = {
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  kind: 'number',
  min: -40,
  max: 150,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
};

const MOTOR_RULE: TelemetryRule = {
  name: 'Motor over-temperature',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  severity: 'critical',
  incidentType: 'equipment_fault',
};

/** No model, so nothing asks for a model file. */
const tower = (id: string, code: string, name: string): AssetDetail => ({
  id,
  code,
  name,
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: zone.id,
  position: zone.center,
  elevationM: 14,
  headingDeg: 0,
  headline: [MOTOR],
  points: [MOTOR],
  rules: [MOTOR_RULE],
});

/** `CT-01` raised the telemetry incident; `CT-02` raised nothing and is its sibling in the zone. */
const TOWER = tower('asset-ct-01', 'CT-01', 'Cooling tower 1');
const SIBLING = tower('asset-ct-02', 'CT-02', 'Cooling tower 2');

const incident = (overrides: Partial<Detail>): Detail => ({
  id: 'incident-op',
  code: 'INC-000043',
  type: 'intrusion',
  severity: 'high',
  status: 'open',
  title: 'Door forced open',
  description: null,
  zoneId: zone.id,
  position: zone.center,
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  timeline: [
    {
      id: 'event-1',
      kind: 'reported',
      note: null,
      at: '2026-10-01T08:00:00.000Z',
      actor: { kind: 'user', subject: SUBJECT, displayName: 'Demo Operator' },
    },
  ],
  ...overrides,
});

/** Raised by `CT-01`'s rule: critical, so resolving it without a note asks first. */
const TELEMETRY = incident({
  id: 'incident-tel',
  code: 'INC-000042',
  type: 'equipment_fault',
  severity: 'critical',
  title: 'Motor over-temperature — Cooling tower 1',
  source: 'telemetry',
  assetId: TOWER.id,
  timeline: [
    {
      id: 'event-1',
      kind: 'reported',
      note: 'motorTempC 92 > 85 for 60 s',
      at: '2026-10-01T08:00:00.000Z',
      actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry rule' },
    },
  ],
});
/** An operator's incident: no asset, so no Telemetry tab, and high, so `R` resolves at once. */
const OPERATOR = incident({});
/** Another active incident in the zone: what the Related tabs list. */
const NEIGHBOUR = incident({ id: 'incident-near', code: 'INC-000044', title: 'Smoke in the lab' });

const fetchMock = vi.fn<typeof fetch>();
const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** What `App` does with the sheet: the asset's inspector, else the incident's detail, else nothing. */
function Sheets() {
  const incidentId = useConsole((s) => s.selectedIncidentId);
  const assetCode = useConsole((s) => s.selectedAssetCode);
  return (
    <SheetHost>
      {assetCode ? (
        <AssetInspector key={assetCode} code={assetCode} />
      ) : incidentId ? (
        <IncidentDetail key={incidentId} id={incidentId} />
      ) : null}
    </SheetHost>
  );
}

/** Everything the sheets read is cached, so each opens on its content; any request stays pending. */
function renderSheets() {
  const client = createTestQueryClient();
  const incidents = [TELEMETRY, OPERATOR, NEIGHBOUR];
  for (const item of incidents) client.setQueryData(queryKeys.incident(item.id), item);
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.zones, [zone]);
  client.setQueryData(queryKeys.cameras, []);
  client.setQueryData(queryKeys.assets, [TOWER, SIBLING]);
  client.setQueryData(queryKeys.asset(TOWER.code), TOWER);
  client.setQueryData(queryKeys.asset(SIBLING.code), SIBLING);
  return renderWithQueryClient(
    <>
      <button type="button">Opener</button>
      <Sheets />
      <TwinShortcuts />
    </>,
    client,
  );
}

/** One of the two contents of the sheet, as the selection opens it. */
interface Content {
  name: string;
  open: () => void;
  /** The sheet's accessible name. */
  sheet: string;
  /** The tab list's accessible name. */
  tablist: string;
  /** The tabs in the order they are drawn, by label (a count follows the label of Related). */
  tabs: readonly string[];
}

const CONTENTS: readonly Content[] = [
  {
    name: 'a telemetry incident',
    open: () => useConsole.getState().select(TELEMETRY.id),
    sheet: 'Incident INC-000042',
    tablist: 'Incident sections',
    tabs: ['Details', 'Related', 'Telemetry', 'Timeline'],
  },
  {
    name: 'an operator’s incident',
    open: () => useConsole.getState().select(OPERATOR.id),
    sheet: 'Incident INC-000043',
    tablist: 'Incident sections',
    tabs: ['Details', 'Related', 'Timeline'],
  },
  {
    name: 'an asset',
    open: () => useConsole.getState().selectAsset(TOWER.code, null),
    sheet: 'Asset CT-01',
    tablist: 'Asset sections',
    tabs: ['Details', 'Related', 'Telemetry', 'Timeline'],
  },
];

const [TELEMETRY_INCIDENT, OPERATOR_INCIDENT, ASSET] = CONTENTS as [Content, Content, Content];

const tabs = () => screen.getAllByRole('tab');
/** A tab by its label; "Related" carries a count after it. */
const tabNamed = (label: string) => {
  const found = tabs().find((tab) => tab.textContent?.startsWith(label));
  if (!found) throw new Error(`No tab "${label}"`);
  return found;
};
const openTab = (label: string) => userEvent.click(tabNamed(label));
const panel = () => screen.getByRole('tabpanel');
const asHere = (element: Element | null) => element as HTMLElement;

/** Renders the sheets and opens `content`, with the sheet there and focused. */
async function show(content: Content) {
  const view = renderSheets();
  act(() => content.open());
  const sheet = await screen.findByRole('complementary', { name: content.sheet });
  return { ...view, sheet };
}

describe('the inspector sheet across its tabs', () => {
  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    resetStore(useTelemetryStore);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    vi.mocked(flyToSelection).mockClear();
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    // A transition answers with the incident moved on; everything else stays pending, so a cached
    // content stays on screen.
    fetchMock.mockReset().mockImplementation((url, init) => {
      if (init?.method !== 'POST') return new Promise<Response>(() => {});
      const resolving = String(url).endsWith('/resolve');
      return Promise.resolve(
        json({
          ...TELEMETRY,
          status: resolving ? 'resolved' : 'acknowledged',
          version: 2,
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    unstubTwin();
    vi.unstubAllGlobals();
  });

  describe.each(CONTENTS)('$name', (content) => {
    describe('the tab list', () => {
      it('offers its tabs in order, named by one tab list, on Details', async () => {
        await show(content);

        expect(screen.getByRole('tablist', { name: content.tablist })).toBeInTheDocument();
        expect(tabs().map((tab) => tab.textContent?.replace(/\s*\d+$/, ''))).toEqual([
          ...content.tabs,
        ]);
        expect(tabNamed('Details')).toHaveAttribute('aria-selected', 'true');
      });

      it('is one Tab stop: the selected tab, and Tab leaves the list for the rest', async () => {
        await show(content);

        expect(tabs().filter((tab) => tab.getAttribute('tabindex') === '0')).toEqual([
          tabNamed('Details'),
        ]);
        expect(tabs().filter((tab) => tab.getAttribute('tabindex') === '-1')).toHaveLength(
          content.tabs.length - 1,
        );

        act(() => tabNamed('Details').focus());
        await userEvent.tab();
        expect(tabs()).not.toContain(document.activeElement);
        await userEvent.tab({ shift: true });
        expect(tabNamed('Details')).toHaveFocus();
      });

      it('moves and selects with ← → Home and End, wrapping at the ends', async () => {
        await show(content);
        const [, second] = content.tabs;
        const last = content.tabs.at(-1)!;
        const expectSelected = (label: string) => {
          const tab = tabNamed(label);
          expect(tab).toHaveFocus();
          expect(tabs().filter((other) => other.getAttribute('aria-selected') === 'true')).toEqual([
            tab,
          ]);
          // The one panel is named by the tab that is selected.
          expect(panel()).toHaveAccessibleName(tab.textContent!);
        };
        act(() => tabNamed('Details').focus());

        await userEvent.keyboard('{ArrowRight}');
        expectSelected(second!);
        await userEvent.keyboard('{End}');
        expectSelected(last);
        await userEvent.keyboard('{ArrowRight}');
        expectSelected('Details');
        await userEvent.keyboard('{ArrowLeft}');
        expectSelected(last);
        await userEvent.keyboard('{Home}');
        expectSelected('Details');
      });
    });

    describe('axe', () => {
      it.each(content.tabs)('reports nothing on the %s tab', async (label) => {
        await show(content);
        await openTab(label);

        expect(tabNamed(label)).toHaveAttribute('aria-selected', 'true');
        await expectNoAxeViolations();
      });
    });

    describe('closing', () => {
      // `SheetHost`: the opener is the control that had focus when the sheet opened, and gets it back
      // when the last sheet closes, whichever tab had focus.
      it.each(['Timeline', 'Telemetry'].filter((label) => content.tabs.includes(label)))(
        'returns focus to the opener on Escape from the %s tab',
        async (label) => {
          renderSheets();
          const opener = screen.getByRole('button', { name: 'Opener' });
          act(() => opener.focus());
          act(() => content.open());
          await screen.findByRole('complementary', { name: content.sheet });
          await openTab(label);

          await userEvent.keyboard('{Escape}');

          expect(screen.queryByRole('complementary')).toBeNull();
          await waitFor(() => expect(opener).toHaveFocus());
        },
      );

      it('returns focus to the opener on Close, from the last tab', async () => {
        renderSheets();
        const opener = screen.getByRole('button', { name: 'Opener' });
        act(() => opener.focus());
        act(() => content.open());
        await screen.findByRole('complementary', { name: content.sheet });
        await openTab(content.tabs.at(-1)!);

        await userEvent.click(screen.getByRole('button', { name: /^Close (incident|asset)$/ }));

        expect(screen.queryByRole('complementary')).toBeNull();
        await waitFor(() => expect(opener).toHaveFocus());
      });
    });
  });

  describe('the panel', () => {
    // A panel of text only has nothing to Tab to; it is the stop itself, so the text can be reached and
    // scrolled (V3-09.8 left this to this task).
    it('is a Tab stop while it holds nothing focusable, and gives way to a control', async () => {
      await show(OPERATOR_INCIDENT);

      await openTab('Timeline');
      expect(panel()).toHaveAttribute('tabindex', '0');
      await userEvent.tab();
      expect(panel()).toHaveFocus();

      await openTab('Related');
      expect(panel()).not.toHaveAttribute('tabindex');
      act(() => tabNamed('Related').focus());
      await userEvent.tab();
      expect(panel()).toContainElement(asHere(document.activeElement));
      expect(panel()).not.toHaveFocus();
    });

    // V3-23.3: a Telemetry panel of text only used to be the stop itself; it now opens on the range
    // switch, so it gives way to it, and Tab from the tab reaches the checked range inside the panel.
    it('gives way to the range switch on the Telemetry tab of an asset whose points all show', async () => {
      await show(ASSET);
      await openTab('Telemetry');

      expect(screen.queryByText(/^All points/)).toBeNull();
      expect(panel()).not.toHaveAttribute('tabindex');
      act(() => tabNamed('Telemetry').focus());
      await userEvent.tab();
      expect(within(panel()).getByRole('radio', { name: '15 min' })).toHaveFocus();
    });

    it('gives way to the range switch on the Telemetry tab of an incident whose points all show', async () => {
      await show(TELEMETRY_INCIDENT);
      await openTab('Telemetry');

      expect(panel()).not.toHaveAttribute('tabindex');
      act(() => tabNamed('Telemetry').focus());
      await userEvent.tab();
      expect(within(panel()).getByRole('radio', { name: '15 min' })).toHaveFocus();
    });

    it('is not one on a Timeline that lists the asset’s incidents, and is one on an empty one', async () => {
      const { sheet } = await show(ASSET);
      await openTab('Timeline');
      expect(within(sheet).getByRole('button', { name: /INC-000042$/ })).toBeInTheDocument();
      expect(panel()).not.toHaveAttribute('tabindex');

      // The sibling raised nothing: its Timeline says so, in text.
      act(() => useConsole.getState().selectAsset(SIBLING.code, null));
      await screen.findByRole('complementary', { name: 'Asset CT-02' });
      await openTab('Timeline');
      expect(screen.getByText('No incidents have been raised by this asset.')).toBeInTheDocument();
      expect(panel()).toHaveAttribute('tabindex', '0');
    });
  });

  describe('focus', () => {
    it('keeps focus in the sheet when another incident is opened from the Related tab', async () => {
      await show(OPERATOR_INCIDENT);
      await openTab('Related');

      await userEvent.click(within(panel()).getByRole('button', { name: /Smoke in the lab/ }));

      const next = await screen.findByRole('complementary', { name: 'Incident INC-000044' });
      expect(next).toHaveFocus();
      expect(screen.queryByRole('complementary', { name: 'Incident INC-000043' })).toBeNull();
      // A new content opens on its Details, not on the tab the last one was left on.
      expect(tabNamed('Details')).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps focus in the sheet when a sibling asset is opened from the Related tab', async () => {
      await show(ASSET);
      await openTab('Related');

      await userEvent.click(within(panel()).getByRole('button', { name: /Cooling tower 2/ }));

      expect(await screen.findByRole('complementary', { name: 'Asset CT-02' })).toHaveFocus();
    });

    it('keeps focus in the sheet when an incident is opened from the asset’s Timeline', async () => {
      await show(ASSET);
      await openTab('Timeline');

      await userEvent.click(within(panel()).getByRole('button', { name: /INC-000042$/ }));

      expect(
        await screen.findByRole('complementary', { name: 'Incident INC-000042' }),
      ).toHaveFocus();
    });

    it('keeps focus in the sheet when the asset is opened from the incident’s Related tab', async () => {
      await show(TELEMETRY_INCIDENT);
      await openTab('Related');

      await userEvent.click(within(panel()).getByRole('button', { name: 'Open asset CT-01' }));

      expect(await screen.findByRole('complementary', { name: 'Asset CT-01' })).toHaveFocus();
    });

    it('selects Details, and keeps focus on the tab list, when the open tab goes away', async () => {
      const { client, sheet } = await show(TELEMETRY_INCIDENT);
      await openTab('Telemetry');
      expect(tabNamed('Telemetry')).toHaveFocus();

      // The catalogue no longer has the asset: the incident has no Telemetry tab any more.
      act(() => client.setQueryData(queryKeys.assets, []));

      await waitFor(() => expect(screen.queryByRole('tab', { name: 'Telemetry' })).toBeNull());
      expect(tabNamed('Details')).toHaveAttribute('aria-selected', 'true');
      expect(panel()).toHaveAccessibleName('Details');
      expect(tabNamed('Details')).toHaveFocus();
      expect(sheet).toContainElement(asHere(document.activeElement));
    });

    it('leaves focus alone when a tab goes away that did not have it', async () => {
      const { client, sheet } = await show(TELEMETRY_INCIDENT);
      await openTab('Telemetry');
      const note = screen.getByLabelText(NOTE_LABEL);
      act(() => note.focus());

      act(() => client.setQueryData(queryKeys.assets, []));

      await waitFor(() => expect(screen.queryByRole('tab', { name: 'Telemetry' })).toBeNull());
      expect(note).toHaveFocus();
      expect(sheet).toContainElement(note);
    });
  });

  describe('keys from the Timeline and Telemetry tabs', () => {
    describe('A and R', () => {
      it.each(['Timeline', 'Telemetry'])('acknowledges on A from the %s tab', async (label) => {
        await show(TELEMETRY_INCIDENT);
        await openTab(label);

        await userEvent.keyboard('a');

        await waitFor(() => expect(postCalls()).toHaveLength(1));
        expect(postCalls()[0]![0]).toBe('/api/incidents/incident-tel/acknowledge');
      });

      it.each(['Timeline', 'Telemetry'])(
        'still asks before resolving a critical incident without a note, on R from the %s tab',
        async (label) => {
          await show(TELEMETRY_INCIDENT);
          await openTab(label);

          await userEvent.keyboard('r');

          expect(
            screen.getByRole('dialog', { name: 'Resolve INC-000042 without a note?' }),
          ).toBeInTheDocument();
          expect(postCalls()).toHaveLength(0);
        },
      );

      it('resolves a high incident at once on R from the Timeline tab', async () => {
        await show(OPERATOR_INCIDENT);
        await openTab('Timeline');

        await userEvent.keyboard('r');

        await waitFor(() => expect(postCalls()).toHaveLength(1));
        expect(postCalls()[0]![0]).toBe('/api/incidents/incident-op/resolve');
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    describe('F', () => {
      it.each(['Timeline', 'Telemetry'])(
        'flies to the asset on F from the %s tab of the asset',
        async (label) => {
          stubTwinAvailable();
          await show(ASSET);
          await openTab(label);

          await userEvent.keyboard('f');

          expect(flyToSelection).toHaveBeenCalledExactlyOnceWith({
            kind: 'asset',
            assetCode: 'CT-01',
          });
        },
      );

      it.each(['Timeline', 'Telemetry'])(
        'frames the incident’s asset on F from the %s tab of the incident',
        async (label) => {
          stubTwinAvailable();
          await show(TELEMETRY_INCIDENT);
          await openTab(label);

          await userEvent.keyboard('f');

          expect(flyToSelection).toHaveBeenCalledExactlyOnceWith({
            kind: 'incident-asset',
            assetCode: 'CT-01',
          });
        },
      );

      it('does nothing while 3D is unavailable', async () => {
        await show(ASSET);
        await openTab('Timeline');

        await userEvent.keyboard('f');

        expect(flyToSelection).not.toHaveBeenCalled();
      });
    });

    describe('Escape', () => {
      it.each(['Timeline', 'Telemetry'])(
        'closes the asset on Escape from the %s tab',
        async (label) => {
          await show(ASSET);
          await openTab(label);

          await userEvent.keyboard('{Escape}');

          expect(useConsole.getState().selectedAssetCode).toBeNull();
          expect(screen.queryByRole('complementary')).toBeNull();
        },
      );

      it.each(['Timeline', 'Telemetry'])(
        'closes the incident on Escape from the %s tab',
        async (label) => {
          await show(TELEMETRY_INCIDENT);
          await openTab(label);

          await userEvent.keyboard('{Escape}');

          expect(useConsole.getState().selectedIncidentId).toBeNull();
          expect(screen.queryByRole('complementary')).toBeNull();
        },
      );

      it('keeps the sheet open on Escape from another tab while a note is written, and says so', async () => {
        const { sheet } = await show(OPERATOR_INCIDENT);
        await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'check the door');
        await openTab('Timeline');

        await userEvent.keyboard('{Escape}');

        expect(screen.getByRole('complementary', { name: 'Incident INC-000043' })).toBe(sheet);
        expect(sheet).toHaveTextContent(NOTE_KEPT);
        expect(screen.getByLabelText(NOTE_LABEL)).toHaveValue('check the door');

        // Close is the way to discard it.
        await userEvent.click(screen.getByRole('button', { name: 'Close incident' }));

        expect(screen.queryByRole('complementary')).toBeNull();
        expect(useConsole.getState().noteDrafts[OPERATOR.id]).toBeUndefined();
      });
    });
  });
});

import type { AssetDetail, TelemetryPoint, TelemetryRule, TelemetryValue } from '@occ/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import { initialTelemetryState } from '../lib/telemetryState';
import type { NodeInfo } from '../lib/twinBindings';
import type { LeaderStart } from '../lib/twinLeader';
import { TWIN_VIEW_ID } from '../lib/twinSummary';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../test-utils';
import { LeaderOverlay, TwinCallout } from './TwinCallout';

const MODEL_URL = '/models/cooling_tower.glb';

const point = (key: string, kind: TelemetryPoint['kind'], unit: string | null): TelemetryPoint => ({
  key,
  label: key,
  unit,
  kind,
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
});

const RULE: TelemetryRule = {
  name: 'Motor over temperature',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  severity: 'high',
  incidentType: 'equipment_fault',
};

/** A cooling tower with its fan (rpm), its motor (a temperature a rule watches) and its breaker (a boolean). */
function detailOf(overrides: Partial<AssetDetail> = {}): AssetDetail {
  const points = [
    point('fanSpeedRpm', 'number', 'rpm'),
    point('motorTempC', 'number', '°C'),
    point('breakerClosed', 'boolean', null),
  ];
  return {
    id: 'asset-ct-01',
    code: 'CT-01',
    name: 'Cooling tower 1',
    class: {
      id: 'class-ct',
      code: 'cooling_tower',
      name: 'Cooling tower',
      modelUrl: MODEL_URL,
      footprintM: { width: 1, depth: 1, height: 1 },
    },
    zoneId: 'zone-dc',
    position: [108.44, 11.95],
    elevationM: 14,
    headingDeg: 0,
    headline: [points[0]!],
    points,
    rules: [RULE],
    ...overrides,
  };
}

const node = (name: string, extras?: unknown, children?: NodeInfo[]): NodeInfo => ({
  name,
  ...(extras === undefined ? {} : { extras }),
  ...(children === undefined ? {} : { children }),
});

const MODEL: NodeInfo = node('CoolingTower', undefined, [
  node('Casing'),
  node('FanBlade', {
    bind: 'fanSpeedRpm',
    motion: 'spin',
    axis: 'y',
    range: [0, 1800],
    label: 'Fan blade',
  }),
  node('Motor', { bind: 'motorTempC', motion: 'tint', label: 'Motor' }),
  node('Breaker', {
    bind: 'breakerClosed',
    motion: 'turn',
    axis: 'x',
    range: [0, 35],
    label: 'Breaker',
  }),
]);

const entry = (ageMs: number, values: Record<string, TelemetryValue>, online = true) => ({
  online,
  receivedAt: new Date(Date.now() - ageMs).toISOString(),
  headline: values,
  values,
  keyReceivedAt: {},
});

type Overview = Record<string, ReturnType<typeof entry>>;

function setOverview(overview: Overview): void {
  act(() => {
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at: Date.now(), mono: performance.now() },
          assets: overview,
        },
        series: new Map(),
      },
    });
  });
}

/**
 * The card with the asset's detail and the model's tree in the cache, as they are once the console has loaded; `null`
 * leaves one out, so its query is still on its way.
 */
function renderCallout({
  detail = detailOf(),
  model = MODEL,
  overview = { 'CT-01': entry(1_000, { fanSpeedRpm: 1420, motorTempC: 71, breakerClosed: true }) },
  onStart = vi.fn(),
}: {
  detail?: AssetDetail | null;
  model?: NodeInfo | null;
  overview?: Overview;
  onStart?: (start: LeaderStart | null) => void;
} = {}) {
  const client = createTestQueryClient();
  if (detail) client.setQueryData(queryKeys.asset('CT-01'), detail);
  if (model) client.setQueryData(queryKeys.model(MODEL_URL), model);
  setOverview(overview);
  return { onStart, ...renderWithQueryClient(<TwinCallout onStart={onStart} />, client) };
}

const select = (part: string | null, asset = 'CT-01') =>
  act(() => {
    useConsole.getState().selectAsset(asset, 'zone-dc');
    useConsole.getState().selectPart(part);
  });
const dialog = (name: string) => screen.getByRole('dialog', { name });

describe('TwinCallout', () => {
  beforeEach(() => {
    resetStore(useConsole);
    // jsdom has no ResizeObserver: the card measures itself with one.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    act(() => resetStore(useTelemetryStore));
  });

  describe('where it shows', () => {
    it('draws nothing at campus, building and asset level', () => {
      renderCallout();
      expect(screen.queryByRole('dialog')).toBeNull();

      act(() => useConsole.getState().focusBuilding('zone-dc'));
      expect(screen.queryByRole('dialog')).toBeNull();

      select(null);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens at part level and goes when the part is deselected', () => {
      renderCallout();
      select('FanBlade');
      expect(dialog('Fan blade')).toBeInTheDocument();

      act(() => useConsole.getState().selectPart(null));

      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('what it says', () => {
    it('reads the part`s asset and node, its label and its live reading, with its unit', () => {
      renderCallout();
      select('FanBlade');

      expect(dialog('Fan blade')).toHaveTextContent('CT-01 · FanBlade');
      expect(dialog('Fan blade')).toHaveTextContent('Fan blade');
      expect(dialog('Fan blade')).toHaveTextContent('1,420 rpm');
      expect(dialog('Fan blade')).toHaveTextContent('Live');
      expect(dialog('Fan blade')).not.toHaveTextContent('last');
    });

    it('updates with the readings', () => {
      renderCallout();
      select('FanBlade');
      expect(dialog('Fan blade')).toHaveTextContent('1,420 rpm');

      setOverview({ 'CT-01': entry(500, { fanSpeedRpm: 1510 }) });

      expect(dialog('Fan blade')).toHaveTextContent('1,510 rpm');
    });

    it('reads "last 1,420 rpm" and the age for a stale asset, never "Live"', () => {
      renderCallout({ overview: { 'CT-01': entry(72_000, { fanSpeedRpm: 1420 }) } });
      select('FanBlade');

      expect(dialog('Fan blade')).toHaveTextContent('last 1,420 rpm');
      expect(dialog('Fan blade')).toHaveTextContent('1 min old');
      expect(dialog('Fan blade')).not.toHaveTextContent('Live');
    });

    it('reads a stale value for an offline device too', () => {
      renderCallout({ overview: { 'CT-01': entry(1_000, { fanSpeedRpm: 1420 }, false) } });
      select('FanBlade');

      expect(dialog('Fan blade')).toHaveTextContent('last 1,420 rpm');
    });

    it('reads the breaker in words, not a number', () => {
      renderCallout();
      select('Breaker');
      expect(dialog('Breaker')).toHaveTextContent('Closed');
      expect(dialog('Breaker')).not.toHaveTextContent('rpm');

      setOverview({ 'CT-01': entry(500, { breakerClosed: false }) });

      expect(dialog('Breaker')).toHaveTextContent('Open');
    });

    it('adds the rule that watches the point: "Limit 85 °C"', () => {
      renderCallout();
      select('Motor');

      expect(dialog('Motor')).toHaveTextContent('71 °C');
      expect(dialog('Motor')).toHaveTextContent('Limit 85 °C');
    });

    it('says nothing else: no pitch, service date, rating, trips or set point', () => {
      renderCallout();
      select('FanBlade');

      expect(dialog('Fan blade')).not.toHaveTextContent(
        /pitch|service|rating|trips|last operated|set point/i,
      );
    });

    it('reads "—" for a bound part the console holds no reading for', () => {
      renderCallout({ overview: {} });
      select('FanBlade');

      expect(dialog('Fan blade')).toHaveTextContent('—');
      expect(dialog('Fan blade')).not.toHaveTextContent('Live');
    });

    it('reads "static" for a part that binds nothing', () => {
      renderCallout();
      select('Casing');

      expect(dialog('Casing')).toHaveTextContent('static');
    });

    it('opens with the node`s name and "—" while the model`s tree and the detail are on their way', () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      renderCallout({ detail: null, model: null });
      select('FanBlade');

      expect(dialog('Fan blade')).toHaveTextContent('CT-01 · FanBlade');
      expect(dialog('Fan blade')).toHaveTextContent('—');
    });

    it('follows the detail when it arrives', async () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      const { client } = renderCallout({ detail: null, model: null });
      select('FanBlade');

      act(() => {
        client.setQueryData(queryKeys.asset('CT-01'), detailOf());
        client.setQueryData(queryKeys.model(MODEL_URL), MODEL);
      });

      await waitFor(() => expect(dialog('Fan blade')).toHaveTextContent('1,420 rpm'));
    });
  });

  describe('closing it', () => {
    it('closes on its Close button, keeps the asset selected and gives the 3D view focus', async () => {
      const user = userEvent.setup();
      const view = document.createElement('div');
      view.id = TWIN_VIEW_ID;
      view.tabIndex = 0;
      document.body.append(view);
      renderCallout();
      select('FanBlade');

      await user.click(screen.getByRole('button', { name: 'Close part details' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useConsole.getState().selectedPart).toBeNull();
      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(view).toHaveFocus();
      view.remove();
    });

    it('closes on Escape inside the card, and leaves the inspector`s asset selected', async () => {
      const user = userEvent.setup();
      renderCallout();
      select('FanBlade');
      screen.getByRole('button', { name: 'Close part details' }).focus();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
    });

    it('does not take focus when it opens', () => {
      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      renderCallout();

      select('FanBlade');

      expect(outside).toHaveFocus();
      outside.remove();
    });

    it('is reachable by Tab: the Close button is a real button', async () => {
      const user = userEvent.setup();
      renderCallout();
      select('FanBlade');

      await user.tab();

      expect(screen.getByRole('button', { name: 'Close part details' })).toHaveFocus();
    });
  });

  describe('the leader`s start', () => {
    it('reports where the line starts when the card opens, and `null` when it closes', () => {
      const onStart = vi.fn();
      renderCallout({ onStart });
      expect(onStart).not.toHaveBeenCalled();

      select('FanBlade');
      expect(onStart).toHaveBeenLastCalledWith({ x: expect.any(Number), y: expect.any(Number) });

      act(() => useConsole.getState().selectPart(null));

      expect(onStart).toHaveBeenLastCalledWith(null);
    });

    it('reports nothing while no part is selected', () => {
      const onStart = vi.fn();
      renderCallout({ onStart });
      select(null);

      expect(onStart).not.toHaveBeenCalled();
    });
  });

  // The figure changes every second: nothing in the card is announced (AC2).
  it('is not a live region', () => {
    const { container } = renderCallout();
    select('FanBlade');

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(dialog('Fan blade')).not.toHaveAttribute('aria-modal');
  });

  // The card reads no session and no permission, so it renders here with neither, and so for every role.
  it('is the same for every role: it reads no permission', () => {
    renderCallout();
    select('FanBlade');

    expect(dialog('Fan blade')).toHaveTextContent('1,420 rpm');
  });

  it('has no accessibility violations', async () => {
    renderCallout();
    select('Motor');

    await expectNoAxeViolations();
  });
});

describe('LeaderOverlay', () => {
  it('draws a line and a dot into the refs the canvas writes, hidden until it does', () => {
    const lineRef = createRef<SVGLineElement>();
    const dotRef = createRef<SVGCircleElement>();

    render(<LeaderOverlay lineRef={lineRef} dotRef={dotRef} />);

    // jsdom defines no `SVGLineElement` or `SVGCircleElement` class, so the elements are told by their tag.
    expect(lineRef.current?.tagName).toBe('line');
    expect(dotRef.current?.tagName).toBe('circle');
    expect(lineRef.current).toHaveAttribute('visibility', 'hidden');
    expect(dotRef.current).toHaveAttribute('visibility', 'hidden');
  });

  it('is hidden from assistive tech and takes no focus', () => {
    const { container } = render(
      <LeaderOverlay
        lineRef={createRef<SVGLineElement>()}
        dotRef={createRef<SVGCircleElement>()}
      />,
    );

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('focusable', 'false');
  });
});

import type { Asset, Camera, Incident, TelemetryPoint, Zone } from '@occ/contracts';
import { act, fireEvent, screen } from '@testing-library/react';
import { queryKeys } from '../api/queries';
import { publishPick } from '../lib/twinPicker';
import { type AssetTelemetryState, initialTelemetryState } from '../lib/telemetryState';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../test-utils';
import { TwinTooltip } from './TwinTooltip';

/* The sheet's width comes from a CSS custom property jsdom does not inherit: it is set here. */
const sheet = vi.hoisted(() => ({ inset: 0 }));
vi.mock('./useSheetOffset', () => ({ sheetInset: () => sheet.inset }));

const POSITION: [number, number] = [108.44, 11.95];

const zone: Zone = {
  id: 'z1',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: POSITION,
  heightM: 14,
};

const point = (key: string, label: string, unit: string): TelemetryPoint => ({
  key,
  label,
  unit,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
});

const FAN = point('fanSpeedRpm', 'Fan speed', 'rpm');
const MOTOR = point('motorTempC', 'Motor temperature', '°C');

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-ct-01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: '/models/cooling-tower.glb',
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: POSITION,
  elevationM: 14,
  headingDeg: 0,
  headline: [FAN, MOTOR],
  ...overrides,
});

const camera = (overrides: Partial<Camera> = {}): Camera => ({
  id: 'c1',
  code: 'CAM-D02',
  name: 'Data center loading bay',
  zoneId: 'z1',
  position: POSITION,
  online: true,
  fieldOfView: null,
  ...overrides,
});

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc',
  code: 'INC-000108',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Motor overheating',
  description: null,
  zoneId: 'z1',
  position: POSITION,
  source: 'telemetry',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  assetId: 'asset-ct-01',
  ...overrides,
});

/** What the console holds of an asset, with the API's clock anchored now. */
function holdTelemetry(codes: string[]) {
  const at = Date.now();
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at, mono: performance.now() },
          assets: Object.fromEntries(
            codes.map((code) => [
              code,
              {
                online: true,
                receivedAt: new Date(at - 3000).toISOString(),
                headline: {},
                values: { fanSpeedRpm: 1420, motorTempC: 71, running: true },
                keyReceivedAt: {},
              } satisfies AssetTelemetryState,
            ]),
          ),
        },
        series: new Map(),
      },
    }),
  );
}

interface Data {
  assets?: Asset[];
  cameras?: Camera[];
  incidents?: Incident[];
  zones?: Zone[];
}

/** The tooltip inside a stage box that holds a canvas, as `TwinStage` has it. */
function renderTooltip({
  assets = [asset(), asset({ id: 'asset-ct-02', code: 'CT-02', name: 'Cooling tower 2' })],
  cameras = [camera()],
  incidents = [],
  zones = [zone],
}: Data = {}) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, assets);
  client.setQueryData(queryKeys.cameras, cameras);
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.zones, zones);
  const view = renderWithQueryClient(
    <div data-testid="stage">
      <canvas data-testid="canvas" />
      <button type="button">Zoom in</button>
      <TwinTooltip />
    </div>,
    client,
  );
  return {
    ...view,
    stage: screen.getByTestId('stage'),
    canvas: screen.getByTestId('canvas'),
  };
}

const move = (target: Element, x = 100, y = 100, pointerType = 'mouse') =>
  fireEvent.pointerMove(target, { clientX: x, clientY: y, pointerType });
const pick = (ref: Parameters<typeof publishPick>[0]) => act(() => publishPick(ref));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** The tooltip: `aria-hidden` on purpose, so it is found with `hidden`. */
const tooltip = () => screen.queryByRole('tooltip', { hidden: true });

/** Sizes jsdom does not lay out: a stage of 800 × 600 and a tooltip of 200 × 100. */
const SIZES = {
  clientWidth: 800,
  clientHeight: 600,
  offsetWidth: 200,
  offsetHeight: 100,
} as const;

describe('TwinTooltip', () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    vi.useFakeTimers();
    sheet.inset = 0;
    resetStore(useConsole);
    resetStore(useTelemetryStore);
    for (const [name, value] of Object.entries(SIZES)) {
      saved.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
    }
  });

  afterEach(() => {
    act(() => publishPick(null));
    vi.useRealTimers();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
    saved.clear();
  });

  it('shows nothing before anything is hovered', () => {
    renderTooltip();

    expect(tooltip()).toBeNull();
  });

  it('shows an asset after 150 ms with its name, code, state, readings and where a click leads (AC1)', () => {
    holdTelemetry(['CT-01']);
    const { canvas } = renderTooltip();

    pick({ kind: 'asset', id: 'CT-01' });
    move(canvas);
    wait(149);
    expect(tooltip()).toBeNull();
    wait(1);

    const tip = tooltip()!;
    expect(tip).toHaveTextContent('Cooling tower 1');
    expect(tip).toHaveTextContent('CT-01');
    expect(tip).toHaveTextContent('Running');
    expect(tip).toHaveTextContent('Fan speed');
    expect(tip).toHaveTextContent('1,420 rpm');
    expect(tip).toHaveTextContent('Motor temperature');
    expect(tip).toHaveTextContent('71 °C');
    // The 3D foot is the place line: the library's roof, not the bare zone of the map.
    expect(tip).toHaveTextContent('Click to inspect · Library · roof');
  });

  it('says an asset is drawn as a box when its class has no model', () => {
    holdTelemetry(['CT-01']);
    const none = asset({ class: { ...asset().class, modelUrl: null } });
    const { canvas } = renderTooltip({ assets: [none] });

    pick({ kind: 'asset', id: 'CT-01' });
    move(canvas);
    wait(150);

    expect(tooltip()).toHaveTextContent('No 3D model · drawn as a box');
    expect(tooltip()).not.toHaveTextContent('Click to inspect');
  });

  it('says a fault with the incident code while the asset is hovered (AC2)', () => {
    holdTelemetry(['CT-01']);
    const { canvas } = renderTooltip({ incidents: [incident()] });

    pick({ kind: 'asset', id: 'CT-01' });
    move(canvas);
    wait(150);

    expect(tooltip()).toHaveTextContent('Fault · INC-000108');
  });

  it('names a camera', () => {
    const { canvas } = renderTooltip({ cameras: [camera({ online: false })] });

    pick({ kind: 'camera', id: 'c1' });
    move(canvas);
    wait(150);

    expect(tooltip()).toHaveTextContent('Data center loading bay');
    expect(tooltip()).toHaveTextContent('CAM-D02 · Library · Offline');
  });

  it('shows none for a part, a building or nothing', () => {
    const { canvas } = renderTooltip();
    move(canvas);

    pick({ kind: 'part', id: 'FanBlade', assetCode: 'CT-01' });
    wait(500);
    expect(tooltip()).toBeNull();

    pick({ kind: 'building', id: 'z1' });
    wait(500);
    expect(tooltip()).toBeNull();

    pick(null);
    wait(500);
    expect(tooltip()).toBeNull();
  });

  it('shows none for an asset the catalogue does not hold', () => {
    const { canvas } = renderTooltip();

    pick({ kind: 'asset', id: 'NOT-THERE' });
    move(canvas);
    wait(500);

    expect(tooltip()).toBeNull();
  });

  it('starts the wait again when the target changes, and goes when the pointer leaves it', () => {
    holdTelemetry(['CT-01', 'CT-02']);
    const { canvas } = renderTooltip();
    pick({ kind: 'asset', id: 'CT-01' });
    move(canvas);
    wait(100);

    pick({ kind: 'asset', id: 'CT-02' });
    wait(100);
    expect(tooltip()).toBeNull();
    wait(50);
    expect(tooltip()).toHaveTextContent('Cooling tower 2');

    pick(null);
    expect(tooltip()).toBeNull();
  });

  it('does not describe a row’s hover: only a pick', () => {
    holdTelemetry(['CT-01']);
    const { canvas } = renderTooltip();
    move(canvas);

    act(() => useConsole.getState().hoverAsset('CT-01'));
    wait(500);

    expect(tooltip()).toBeNull();
  });

  describe('goes, and comes back with the next move', () => {
    const shownOver = () => {
      holdTelemetry(['CT-01']);
      const view = renderTooltip();
      pick({ kind: 'asset', id: 'CT-01' });
      move(view.canvas);
      wait(150);
      expect(tooltip()).not.toBeNull();
      return view;
    };

    it('on a press: a click flies the camera, and the pick under the pointer is stale', () => {
      const { canvas } = shownOver();

      fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
      expect(tooltip()).toBeNull();

      // Still down the pick may change, and a tooltip must not come back without a move.
      pick({ kind: 'asset', id: 'CT-01' });
      wait(500);
      expect(tooltip()).toBeNull();

      move(canvas, 101, 100);
      wait(150);
      expect(tooltip()).not.toBeNull();
    });

    it('on a wheel turn: the camera zooms under a still pointer', () => {
      const { canvas } = shownOver();

      fireEvent.wheel(canvas);
      expect(tooltip()).toBeNull();

      move(canvas, 101, 100);
      wait(150);
      expect(tooltip()).not.toBeNull();
    });

    it('when the pointer leaves the stage', () => {
      const { canvas, stage } = shownOver();

      fireEvent.pointerLeave(stage);
      expect(tooltip()).toBeNull();

      move(canvas, 101, 100);
      wait(150);
      expect(tooltip()).not.toBeNull();
    });

    it('when the pointer goes over something that is not the canvas, such as a control', () => {
      const { canvas } = shownOver();

      move(screen.getByRole('button', { name: 'Zoom in' }));
      expect(tooltip()).toBeNull();

      move(canvas, 101, 100);
      wait(150);
      expect(tooltip()).not.toBeNull();
    });

    it('while the report location is picked', () => {
      const { canvas } = shownOver();

      act(() => useConsole.getState().setPicking(true));
      expect(tooltip()).toBeNull();
      move(canvas, 101, 100);
      wait(500);
      expect(tooltip()).toBeNull();

      act(() => useConsole.getState().setPicking(false));
      wait(150);
      expect(tooltip()).not.toBeNull();
    });
  });

  it('shows nothing for a touch', () => {
    holdTelemetry(['CT-01']);
    const { canvas } = renderTooltip();

    pick({ kind: 'asset', id: 'CT-01' });
    move(canvas, 100, 100, 'touch');
    wait(500);

    expect(tooltip()).toBeNull();
  });

  describe('where it stands', () => {
    const at = (x: number, y: number) => {
      holdTelemetry(['CT-01']);
      const { canvas } = renderTooltip();
      pick({ kind: 'asset', id: 'CT-01' });
      move(canvas, x, y);
      wait(150);
      return tooltip()!;
    };

    it('is 18 px right of and below the pointer', () => {
      expect(at(100, 100).style.transform).toBe('translate(118px, 118px)');
    });

    it('moves to the left of the pointer at the right edge of the stage', () => {
      expect(at(700, 100).style.transform).toBe('translate(482px, 118px)');
    });

    it('keeps clear of the open sheet', () => {
      sheet.inset = 400;

      expect(at(300, 100).style.transform).toBe('translate(82px, 118px)');
    });

    it('stays inside the bottom of the stage', () => {
      expect(at(100, 590).style.transform).toBe('translate(118px, 500px)');
    });

    it('follows the pointer while it is shown, without rendering again', () => {
      const tip = at(100, 100);

      move(screen.getByTestId('canvas'), 200, 150);

      expect(tooltip()).toBe(tip);
      expect(tip.style.transform).toBe('translate(218px, 168px)');
    });
  });

  it('is hidden from assistive tech: the Assets tab is the route to the same words', () => {
    holdTelemetry(['CT-01']);
    const { canvas } = renderTooltip();
    pick({ kind: 'asset', id: 'CT-01' });
    move(canvas);
    wait(150);

    expect(tooltip()!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('has no accessibility violation while it is shown', async () => {
    vi.useRealTimers();
    holdTelemetry(['CT-01']);
    const { canvas, container } = renderTooltip();
    pick({ kind: 'asset', id: 'CT-01' });
    move(canvas);
    await screen.findByRole('tooltip', { hidden: true });

    await expectNoAxeViolations(container);
  });
});

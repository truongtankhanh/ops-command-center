import { Registry } from '@prometheus-io/client';
import { TELEMETRY_MESSAGE_RESULTS, TelemetryMetrics } from './telemetry.metrics';

async function messages(registry: Registry) {
  return (await registry.getSingleMetric('telemetry_messages_total')!.get()).values;
}

/** The count of each result, by name. */
async function counts(registry: Registry): Promise<Record<string, number>> {
  const values = await messages(registry);
  return Object.fromEntries(values.map((value) => [String(value.labels.result), value.value]));
}

const GAUGES = ['telemetry_connected_consoles', 'telemetry_upstream_up', 'telemetry_leader'];

describe('TelemetryMetrics', () => {
  let registry: Registry;
  let metrics: TelemetryMetrics;

  beforeEach(() => {
    registry = new Registry();
    metrics = new TelemetryMetrics(registry);
  });

  it('has every result at 0 before the first reading, so alerts see the series', async () => {
    expect(await messages(registry)).toEqual(
      TELEMETRY_MESSAGE_RESULTS.map((result) => ({ labels: { result }, value: 0 })),
    );
  });

  it('counts one reading under its result only', async () => {
    metrics.countMessage('invalid');

    expect(await counts(registry)).toEqual({
      accepted: 0,
      unknown_asset: 0,
      invalid: 1,
      clock_skew: 0,
    });
  });

  it('adds up readings of the same result', async () => {
    metrics.countMessage('accepted');
    metrics.countMessage('accepted');
    metrics.countMessage('clock_skew');

    expect(await counts(registry)).toEqual({
      accepted: 2,
      unknown_asset: 0,
      invalid: 0,
      clock_skew: 1,
    });
  });

  it('labels by result alone: never an asset code', async () => {
    metrics.countMessage('unknown_asset');

    const labelNames = new Set((await messages(registry)).flatMap((v) => Object.keys(v.labels)));
    expect([...labelNames]).toEqual(['result']);
  });

  it('registers on the registry it is given, so two apps in one process do not collide', async () => {
    const other = new Registry();

    expect(() => new TelemetryMetrics(other)).not.toThrow();
    metrics.countMessage('accepted');

    expect((await counts(registry)).accepted).toBe(1);
    expect((await counts(other)).accepted).toBe(0);
  });

  describe('gauges', () => {
    /** The one unlabelled sample of a gauge, read as a scrape would. */
    async function gauge(target: Registry, name: string) {
      const { values } = await target.getSingleMetric(name)!.get();
      return values;
    }

    it('are present from the first scrape, at 0, before anything is tracked', async () => {
      for (const name of GAUGES) {
        expect(await gauge(registry, name)).toEqual([
          expect.objectContaining({ labels: {}, value: 0 }),
        ]);
      }
    });

    it('read what is tracked at scrape time, not when it was registered', async () => {
      let consoles = 2;
      let live = false;
      let leading = false;
      metrics.trackConsoles(() => consoles);
      metrics.trackUpstream(() => live);
      metrics.trackLeader(() => leading);

      expect((await gauge(registry, 'telemetry_connected_consoles'))[0]?.value).toBe(2);
      expect((await gauge(registry, 'telemetry_upstream_up'))[0]?.value).toBe(0);
      expect((await gauge(registry, 'telemetry_leader'))[0]?.value).toBe(0);

      consoles = 5;
      live = true;
      leading = true;

      expect((await gauge(registry, 'telemetry_connected_consoles'))[0]?.value).toBe(5);
      expect((await gauge(registry, 'telemetry_upstream_up'))[0]?.value).toBe(1);
      expect((await gauge(registry, 'telemetry_leader'))[0]?.value).toBe(1);
    });

    it('have no label: never an asset code', async () => {
      metrics.trackConsoles(() => 1);
      metrics.trackUpstream(() => true);
      metrics.trackLeader(() => true);

      for (const name of GAUGES) {
        const labels = (await gauge(registry, name)).flatMap((value) => Object.keys(value.labels));
        expect(labels).toEqual([]);
      }
    });

    it('track per registry, so two apps in one process keep their own readers', async () => {
      const other = new Registry();
      const otherMetrics = new TelemetryMetrics(other);
      metrics.trackConsoles(() => 3);
      otherMetrics.trackConsoles(() => 7);

      expect((await gauge(registry, 'telemetry_connected_consoles'))[0]?.value).toBe(3);
      expect((await gauge(other, 'telemetry_connected_consoles'))[0]?.value).toBe(7);
    });
  });
});

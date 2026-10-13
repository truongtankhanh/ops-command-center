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
});

import { type Histogram, Registry } from '@prometheus-io/client';
import { IncidentEvents } from '@occ/contracts';
import { RealtimeMetrics } from './realtime.metrics';

const NOW = Date.parse('2026-10-05T08:00:00.000Z');

/** Bucket, sum and count values; `string` labels, since buckets add `le` to `event`. */
async function delivery(registry: Registry) {
  const histogram = registry.getSingleMetric(
    'incident_event_delivery_seconds',
  ) as Histogram<string>;
  return (await histogram.get()).values;
}

describe('RealtimeMetrics', () => {
  let registry: Registry;
  let metrics: RealtimeMetrics;

  beforeEach(() => {
    registry = new Registry();
    metrics = new RealtimeMetrics(registry);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('incident_event_delivery_seconds', () => {
    it('records the time since the outbox row was written, labelled by event only', async () => {
      metrics.observeDelivery(IncidentEvents.Created, new Date(NOW - 300));

      const values = await delivery(registry);
      const bucket = (le: number) =>
        values.find((v) => v.metricName?.endsWith('_bucket') && v.labels.le === le)?.value;
      expect(bucket(0.25)).toBe(0);
      expect(bucket(0.5)).toBe(1);
      expect(values).toContainEqual(
        expect.objectContaining({
          metricName: 'incident_event_delivery_seconds_sum',
          labels: { event: 'incident.created' },
          value: 0.3,
        }),
      );
    });

    it('records a row stamped ahead of this clock (skew) as zero, never negative', async () => {
      metrics.observeDelivery(IncidentEvents.Updated, new Date(NOW + 2_000));

      const values = await delivery(registry);
      expect(values).toContainEqual(
        expect.objectContaining({
          metricName: 'incident_event_delivery_seconds_sum',
          labels: { event: 'incident.updated' },
          value: 0,
        }),
      );
      expect(values).toContainEqual(
        expect.objectContaining({
          metricName: 'incident_event_delivery_seconds_count',
          labels: { event: 'incident.updated' },
          value: 1,
        }),
      );
    });
  });

  describe('realtime_connected_consoles', () => {
    it('reads 0 until the gateway registers its socket count', async () => {
      expect(await registry.metrics()).toMatch(/^realtime_connected_consoles 0$/m);
    });

    it('reads the registered count on every scrape, so it follows the namespace', async () => {
      let sockets = 3;
      metrics.trackConsoles(() => sockets);

      expect(await registry.metrics()).toMatch(/^realtime_connected_consoles 3$/m);
      sockets = 1;
      expect(await registry.metrics()).toMatch(/^realtime_connected_consoles 1$/m);
    });
  });
});

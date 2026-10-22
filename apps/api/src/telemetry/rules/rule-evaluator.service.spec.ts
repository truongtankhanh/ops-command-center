import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { IncidentDetail, TelemetryPoint, TelemetryValue } from '@occ/contracts';
import type { ResolvableRule } from '../../assets/asset-resolution';
import type { AssetsService, CatalogueAsset } from '../../assets/assets.service';
import type { Env } from '../../config/env.validation';
import type { IncidentsService, TelemetryIncidentResult } from '../../incidents/incidents.service';
import type { TelemetryMetrics } from '../../metrics/telemetry.metrics';
import {
  RULE_CATALOGUE_REFRESH_MS,
  RULE_EVALUATION_MS,
  RuleEvaluator,
} from './rule-evaluator.service';
import type { TelemetryChange, TelemetryIngestService } from '../ingest/telemetry-ingest.service';
import type { TelemetryLeader } from '../ingest/telemetry-leader.service';

const T0 = Date.parse('2026-10-14T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000);

const RAISED = {
  outcome: 'raised',
  incident: { code: 'INC-000042' } as IncidentDetail,
} satisfies TelemetryIncidentResult;
const ALREADY_OPEN = { outcome: 'already_open' } satisfies TelemetryIncidentResult;

const point = (
  key: string,
  kind: TelemetryPoint['kind'] = 'number',
  expectedIntervalS = 10,
): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind,
  min: null,
  max: null,
  enumValues: kind === 'enum' ? ['on', 'off'] : null,
  expectedIntervalS,
  headline: null,
});

/** The 85 / 80 / 60 s rule of the cooling tower; `assetId` makes it an override. */
const rule = (name: string, over: Partial<ResolvableRule> = {}): ResolvableRule => ({
  id: `${over.assetId ?? 'class'}/${name}`,
  name,
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  severity: 'critical',
  incidentType: 'equipment_fault',
  assetId: null,
  enabled: true,
  ...over,
});

const asset = (over: Partial<CatalogueAsset> = {}): CatalogueAsset => ({
  id: 'asset-1',
  code: 'CT-01',
  points: [point('motorTempC'), point('running', 'boolean'), point('switchState', 'enum')],
  rules: [rule('Motor over-temperature')],
  ...over,
});

/**
 * The part of the ingest service the evaluator reads, with its semantics: a version that counts
 * every arrival, and the changes received since a cursor.
 */
class FakeIngest {
  private version = 0;
  private readonly arrivals: Array<{ version: number; change: TelemetryChange }> = [];
  readonly changedSince = jest.fn((cursor: number) => ({
    version: this.version,
    changes: this.arrivals.filter((a) => a.version > cursor).map((a) => a.change),
  }));

  /** One reading, `seconds` after `T0`. */
  receive(
    seconds: number,
    values: Record<string, TelemetryValue>,
    assetCode = 'CT-01',
    assetId = 'asset-1',
  ): void {
    this.version += 1;
    const time = at(seconds).toISOString();
    this.arrivals.push({
      version: this.version,
      change: { assetCode, assetId, values, at: time, receivedAt: time },
    });
  }
}

function setup(options: { source?: Env['TELEMETRY_SOURCE']; assets?: CatalogueAsset[] } = {}) {
  const state = {
    leading: true,
    catalogue: options.assets ?? [asset()],
    catalogueFailure: undefined as unknown,
    /** What the incidents service answers next, consumed in order; `RAISED` when empty. */
    answers: [] as Array<TelemetryIncidentResult | Error>,
    gate: undefined as Promise<void> | undefined,
  };
  const ingest = new FakeIngest();
  const leader = { isLeading: jest.fn(() => state.leading) };
  const assets = {
    catalogue: jest.fn(async () => {
      if (state.catalogueFailure !== undefined) throw state.catalogueFailure;
      return state.catalogue;
    }),
  };
  const incidents = {
    reportFromTelemetry: jest.fn(
      async (_input: { assetId: string; telemetryRuleId: string; note: string }) => {
        await state.gate;
        const next = state.answers.shift() ?? RAISED;
        if (next instanceof Error) throw next;
        return next;
      },
    ),
  };
  const metrics = { countIncident: jest.fn() };
  const config = { getOrThrow: jest.fn(() => options.source ?? 'mock') };
  const evaluator = new RuleEvaluator(
    config as unknown as ConfigService<Env, true>,
    ingest as unknown as TelemetryIngestService,
    leader as unknown as TelemetryLeader,
    assets as unknown as AssetsService,
    incidents as unknown as IncidentsService,
    metrics as unknown as TelemetryMetrics,
  );
  return { state, ingest, leader, assets, incidents, metrics, evaluator };
}

/** An evaluator that has gained the lead: its first leading tick has read the catalogue. */
async function leading(options: Parameters<typeof setup>[0] = {}) {
  const world = setup(options);
  await world.evaluator.evaluate(at(0));
  return world;
}

/** `value` of `motorTempC` every 10 s from `from` to `to`, inclusive. */
function breach(ingest: FakeIngest, from: number, to: number, value = 90): void {
  for (let seconds = from; seconds <= to; seconds += 10)
    ingest.receive(seconds, { motorTempC: value });
}

describe('RuleEvaluator', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('when it is not the leader', () => {
    it('reads neither the catalogue nor the ingest service, and asks for nothing', async () => {
      const { evaluator, state, ingest, assets, incidents } = setup();
      state.leading = false;
      breach(ingest, 0, 60);

      await evaluator.evaluate(at(60));

      expect(assets.catalogue).not.toHaveBeenCalled();
      expect(ingest.changedSince).not.toHaveBeenCalled();
      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });
  });

  describe('a sustained breach', () => {
    it('asks once, with the asset, the rule and the evidence, when it has lasted for_s', async () => {
      const { evaluator, ingest, incidents, metrics } = await leading();
      breach(ingest, 0, 60, 92);

      await evaluator.evaluate(at(60));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
      expect(incidents.reportFromTelemetry).toHaveBeenCalledWith({
        assetId: 'asset-1',
        telemetryRuleId: 'class/Motor over-temperature',
        note: 'motorTempC 92 > 85 for 60 s',
      });
      expect(metrics.countIncident).toHaveBeenCalledWith('raised');
      expect(log).toHaveBeenCalledWith('Rule class/Motor over-temperature raised INC-000042');
    });

    it('asks for nothing before for_s has passed', async () => {
      const { evaluator, ingest, incidents } = await leading();
      breach(ingest, 0, 50);

      await evaluator.evaluate(at(50));

      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });

    it('asks for nothing more while the breach goes on', async () => {
      const { evaluator, ingest, incidents } = await leading();
      breach(ingest, 0, 60);
      await evaluator.evaluate(at(60));

      breach(ingest, 70, 200);
      await evaluator.evaluate(at(200));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
    });

    it('works across ticks: the dwell is carried from one tick to the next', async () => {
      const { evaluator, ingest, incidents } = await leading();

      for (let seconds = 0; seconds <= 60; seconds += 10) {
        ingest.receive(seconds, { motorTempC: 90 });
        await evaluator.evaluate(at(seconds));
      }

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
    });

    it('raises again after the reading passed clear and the breach lasted again', async () => {
      const { evaluator, ingest, incidents } = await leading();
      breach(ingest, 0, 60);
      ingest.receive(70, { motorTempC: 80 });
      breach(ingest, 80, 140);

      await evaluator.evaluate(at(140));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(2);
    });

    it('is told "already open" and then asks no more for that breach', async () => {
      const { evaluator, state, ingest, incidents, metrics } = await leading();
      state.answers.push(ALREADY_OPEN);
      breach(ingest, 0, 60);
      await evaluator.evaluate(at(60));

      breach(ingest, 70, 130);
      await evaluator.evaluate(at(130));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
      expect(metrics.countIncident).toHaveBeenCalledWith('already_open');
      expect(metrics.countIncident).not.toHaveBeenCalledWith('error');
      expect(debug).toHaveBeenCalledWith(
        'Rule class/Motor over-temperature already has an open incident',
      );
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('when the lead is gained', () => {
    it('does not judge what arrived before it: it starts from the next reading', async () => {
      const { evaluator, ingest, incidents } = setup();
      breach(ingest, 0, 60);

      await evaluator.evaluate(at(60));
      await evaluator.evaluate(at(61));

      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });

    it('does not carry a state over a lost lead: every machine starts armed', async () => {
      const { evaluator, state, ingest, incidents } = await leading();
      breach(ingest, 0, 50);
      await evaluator.evaluate(at(50));

      state.leading = false;
      await evaluator.evaluate(at(51));
      state.leading = true;
      await evaluator.evaluate(at(52));
      // 60 s after the first reading of the lost lead, but the first of this one.
      ingest.receive(60, { motorTempC: 90 });
      await evaluator.evaluate(at(60));

      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });

    it('stops asking the moment the lead is lost, between two writes', async () => {
      const second = rule('Second rule');
      const { evaluator, state, ingest, incidents } = await leading({
        assets: [asset({ rules: [rule('First rule'), second] })],
      });
      breach(ingest, 0, 60);
      // The lead goes while the first write is in flight.
      incidents.reportFromTelemetry.mockImplementationOnce(async () => {
        state.leading = false;
        return RAISED;
      });

      await evaluator.evaluate(at(60));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the write fails', () => {
    it('counts it, keeps its place, and asks again at the next breaching reading', async () => {
      const { evaluator, state, ingest, incidents, metrics } = await leading();
      state.answers.push(new Error('connection terminated'));
      breach(ingest, 0, 60);
      await expect(evaluator.evaluate(at(60))).resolves.toBeUndefined();

      expect(metrics.countIncident).toHaveBeenCalledWith('error');
      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);

      // Nothing new arrived: nothing is asked. The state was not advanced past the breach.
      await evaluator.evaluate(at(65));
      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);

      ingest.receive(70, { motorTempC: 93 });
      await evaluator.evaluate(at(70));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(2);
      expect(incidents.reportFromTelemetry).toHaveBeenLastCalledWith(
        expect.objectContaining({ note: 'motorTempC 93 > 85 for 60 s' }),
      );
      expect(metrics.countIncident).toHaveBeenLastCalledWith('raised');
    });

    it('says so once while it keeps failing, and once when it is back', async () => {
      const { evaluator, state, ingest } = await leading();
      state.answers.push(new Error('down'), new Error('still down'));
      breach(ingest, 0, 60);
      await evaluator.evaluate(at(60));
      ingest.receive(70, { motorTempC: 90 });
      await evaluator.evaluate(at(70));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Telemetry incident write failed, will retry: down');

      ingest.receive(80, { motorTempC: 90 });
      await evaluator.evaluate(at(80));

      expect(log).toHaveBeenCalledWith('Telemetry incident writes recovered');
    });

    it('never writes an asset code in a log line', async () => {
      const { evaluator, state, ingest } = await leading();
      state.answers.push(new Error('down'), ALREADY_OPEN);
      breach(ingest, 0, 60);
      await evaluator.evaluate(at(60));
      ingest.receive(70, { motorTempC: 90 });
      await evaluator.evaluate(at(70));

      for (const call of [...log.mock.calls, ...warn.mock.calls, ...debug.mock.calls]) {
        expect(String(call[0])).not.toContain('CT-01');
      }
    });
  });

  describe('which rules are evaluated', () => {
    it('never evaluates a rule on an enum point, on a key the asset lacks, or one that is disabled', async () => {
      const { evaluator, ingest, incidents } = await leading({
        assets: [
          asset({
            rules: [
              rule('Disabled', { enabled: false }),
              rule('On an enum', {
                key: 'switchState',
                comparator: 'above',
                limit: 0.5,
                clear: 0.5,
              }),
              rule('On nothing', { key: 'noSuchPoint' }),
            ],
          }),
        ],
      });
      for (let seconds = 0; seconds <= 120; seconds += 10) {
        ingest.receive(seconds, { motorTempC: 99, switchState: 'on' });
      }

      await evaluator.evaluate(at(120));

      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });

    it("evaluates an asset's override instead of the class rule, for that asset only", async () => {
      const override = rule('Motor over-temperature', { assetId: 'asset-1', limit: 95, clear: 90 });
      const { evaluator, ingest, incidents } = await leading({
        assets: [
          asset({ rules: [rule('Motor over-temperature'), override] }),
          asset({
            id: 'asset-2',
            code: 'CT-02',
            rules: [rule('Motor over-temperature'), override],
          }),
        ],
      });
      for (let seconds = 0; seconds <= 60; seconds += 10) {
        ingest.receive(seconds, { motorTempC: 90 }, 'CT-01', 'asset-1');
        ingest.receive(seconds, { motorTempC: 90 }, 'CT-02', 'asset-2');
      }

      await evaluator.evaluate(at(60));

      // 90 is not over the override's 95, and is over the class rule's 85.
      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
      expect(incidents.reportFromTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: 'asset-2',
          telemetryRuleId: 'class/Motor over-temperature',
        }),
      );
    });

    it('evaluates a boolean point as 1 and 0', async () => {
      const { evaluator, ingest, incidents } = await leading({
        assets: [
          asset({
            rules: [
              rule('Stopped', {
                key: 'running',
                comparator: 'below',
                limit: 0.5,
                clear: 0.5,
                forS: 10,
              }),
            ],
          }),
        ],
      });
      ingest.receive(0, { running: false });
      ingest.receive(10, { running: false });

      await evaluator.evaluate(at(10));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'running 0 < 0.5 for 10 s' }),
      );
    });
  });

  describe('the catalogue', () => {
    it('starts a rule over when its values changed in a refresh', async () => {
      const { evaluator, state, ingest, incidents } = await leading();
      breach(ingest, 0, 50);
      await evaluator.evaluate(at(50));

      state.catalogue = [
        asset({ rules: [rule('Motor over-temperature', { limit: 80, clear: 70 })] }),
      ];
      ingest.receive(60, { motorTempC: 90 });
      await evaluator.evaluate(at(RULE_CATALOGUE_REFRESH_MS / 1000));

      // Without the reset the breach that began at 0 s would be 60 s old.
      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });

    it('drops the machine of a rule that left it', async () => {
      const { evaluator, state, ingest, incidents } = await leading();
      breach(ingest, 0, 50);
      await evaluator.evaluate(at(50));

      state.catalogue = [asset({ rules: [] })];
      await evaluator.evaluate(at(60));
      state.catalogue = [asset()];
      await evaluator.evaluate(at(120));
      ingest.receive(120, { motorTempC: 90 });
      await evaluator.evaluate(at(121));

      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });

    it('keeps the previous copy when a refresh fails, and says so once', async () => {
      const { evaluator, state, ingest, assets, incidents } = await leading();
      breach(ingest, 0, 50);
      await evaluator.evaluate(at(50));

      state.catalogueFailure = new Error('connection terminated');
      ingest.receive(60, { motorTempC: 90 });
      await evaluator.evaluate(at(60));
      ingest.receive(70, { motorTempC: 90 });
      await evaluator.evaluate(at(70));

      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
      expect(assets.catalogue).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'Rule catalogue read failed, keeping the previous one: connection terminated',
      );
    });

    it('reads it again every 60 s and not before, while it has one', async () => {
      const { evaluator, assets } = await leading();

      await evaluator.evaluate(at(RULE_CATALOGUE_REFRESH_MS / 1000 - 1));
      expect(assets.catalogue).toHaveBeenCalledTimes(1);

      await evaluator.evaluate(at(RULE_CATALOGUE_REFRESH_MS / 1000));
      expect(assets.catalogue).toHaveBeenCalledTimes(2);
    });

    it('retries every tick until the first read succeeds, then slowly', async () => {
      const { evaluator, state, assets, ingest, incidents } = setup();
      state.catalogueFailure = new Error('down');

      await evaluator.evaluate(at(0));
      await evaluator.evaluate(at(1));
      await evaluator.evaluate(at(2));
      expect(assets.catalogue).toHaveBeenCalledTimes(3);

      state.catalogueFailure = undefined;
      await evaluator.evaluate(at(3));
      await evaluator.evaluate(at(4));
      expect(assets.catalogue).toHaveBeenCalledTimes(4);

      breach(ingest, 10, 70);
      await evaluator.evaluate(at(70));
      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('ticks', () => {
    it('share one run when they overlap', async () => {
      const { evaluator, state, ingest, incidents } = await leading();
      breach(ingest, 0, 60);
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      const first = evaluator.evaluate(at(60));
      const second = evaluator.evaluate(at(60));
      open();
      await Promise.all([first, second]);

      expect(second).toBe(first);
      expect(incidents.reportFromTelemetry).toHaveBeenCalledTimes(1);
    });

    it('does not reject when something unexpected throws', async () => {
      const { evaluator, ingest } = await leading();
      ingest.changedSince.mockImplementationOnce(() => {
        throw new Error('unexpected');
      });

      await expect(evaluator.evaluate(at(1))).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('Telemetry rule evaluation failed, will retry: unexpected');
    });
  });

  describe('the timer', () => {
    beforeEach(() => jest.useFakeTimers({ now: T0 }));

    it('starts none on a replica with TELEMETRY_SOURCE=off', () => {
      const { evaluator } = setup({ source: 'off' });

      evaluator.onApplicationBootstrap();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not keep the process alive on its own', () => {
      const interval = jest.spyOn(globalThis, 'setInterval');
      const { evaluator } = setup();

      evaluator.onApplicationBootstrap();

      const timer = interval.mock.results[0]?.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
    });

    it(`ticks every ${RULE_EVALUATION_MS} ms and not before`, async () => {
      const { evaluator, leader } = setup();
      evaluator.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(RULE_EVALUATION_MS - 1);
      expect(leader.isLeading).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(leader.isLeading).toHaveBeenCalledTimes(1);
    });

    it('stops at shutdown, and waits for a write in flight', async () => {
      const { evaluator, state, ingest, incidents } = await leading();
      evaluator.onApplicationBootstrap();
      breach(ingest, 0, 60);
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const running = evaluator.evaluate(at(60));
      await Promise.resolve();

      let stopped = false;
      const stopping = evaluator.beforeApplicationShutdown().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      open();
      await Promise.all([running, stopping]);
      expect(stopped).toBe(true);

      incidents.reportFromTelemetry.mockClear();
      breach(ingest, 70, 130);
      await jest.advanceTimersByTimeAsync(RULE_EVALUATION_MS * 3);
      expect(incidents.reportFromTelemetry).not.toHaveBeenCalled();
    });
  });
});

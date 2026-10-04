import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { randomPointIn } from '../common/geo';
import type { Env } from '../config/env.validation';
import { IncidentEntity } from '../incidents/incident.entity';
import { IncidentsService } from '../incidents/incidents.service';
import { ZoneEntity } from '../zones/zone.entity';
import { pickWeighted, scenariosFor } from './scenarios';
import { SimulatorLeader } from './simulator-leader.service';

const MAX_ACTIVE = 8;
const ACK_AFTER_MS = 20_000;
const RESOLVE_AFTER_MS = 45_000;

/**
 * Demo traffic generator: reports incidents and plays the role of other operators
 * acknowledging and resolving them. It goes through `IncidentsService` exactly like
 * a real operator, so it exercises the same rules, persistence and events.
 * With several replicas, only the one holding the `SimulatorLeader` lock ticks.
 */
@Injectable()
export class SimulatorService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(SimulatorService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly incidentsService: IncidentsService,
    @InjectRepository(IncidentEntity) private readonly incidents: Repository<IncidentEntity>,
    @InjectRepository(ZoneEntity) private readonly zones: Repository<ZoneEntity>,
    private readonly leader: SimulatorLeader,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('SIMULATOR_ENABLED', { infer: true })) return;
    const interval = this.config.get('SIMULATOR_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.tickIfLeader(), interval);
    this.logger.log(`Simulator on — one tick every ${interval} ms on the leading replica`);
  }

  /** Before TypeORM closes the pool, so the leader can unlock and hand back its connection. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.leader.release();
  }

  private async tickIfLeader(): Promise<void> {
    if (await this.leader.isLeader()) await this.tick();
  }

  /** One step of simulated activity. Public so it can be driven directly in tests. */
  async tick(random: () => number = Math.random, now = new Date()): Promise<void> {
    if (this.running) return; // never overlap ticks
    this.running = true;
    try {
      await this.progressExisting(random, now);
      await this.reportNew(random);
    } catch (error) {
      this.logger.warn(`Simulator tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async reportNew(random: () => number): Promise<void> {
    const active = await this.incidents.countBy({
      source: 'simulator',
      status: In(['open', 'acknowledged']),
    });
    if (active >= MAX_ACTIVE) return;

    const zones = await this.zones.find();
    if (zones.length === 0) return;
    const zone = zones[Math.floor(random() * zones.length)]!;
    const scenario = pickWeighted(scenariosFor(zone.kind), random);

    await this.incidentsService.report(
      {
        type: scenario.type,
        severity: scenario.severity,
        title: scenario.titles[Math.floor(random() * scenario.titles.length)]!,
        description: scenario.description,
        zoneId: zone.id,
        position: randomPointIn(zone.polygon, random),
      },
      'simulator',
    );
  }

  private async progressExisting(random: () => number, now: Date): Promise<void> {
    const toResolve = await this.incidents.findOne({
      where: {
        source: 'simulator',
        status: 'acknowledged',
        acknowledgedAt: LessThan(new Date(now.getTime() - RESOLVE_AFTER_MS)),
      },
      order: { acknowledgedAt: 'ASC' },
    });
    if (toResolve && random() < 0.6) {
      await this.incidentsService.resolve(toResolve.id, 'Handled by field team (simulated).');
    }

    const toAcknowledge = await this.incidents.findOne({
      where: {
        source: 'simulator',
        status: 'open',
        reportedAt: LessThan(new Date(now.getTime() - ACK_AFTER_MS)),
      },
      order: { reportedAt: 'ASC' },
    });
    if (toAcknowledge && random() < 0.5) {
      await this.incidentsService.acknowledge(toAcknowledge.id);
    }
  }
}

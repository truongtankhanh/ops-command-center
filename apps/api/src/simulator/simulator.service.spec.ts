import type { ZoneKind } from '@occ/contracts';
import type { Repository } from 'typeorm';
import { rectangle } from '../common/geo';
import type { IncidentEntity } from '../incidents/incident.entity';
import type { IncidentsService } from '../incidents/incidents.service';
import type { ZoneEntity } from '../zones/zone.entity';
import { SimulatorService } from './simulator.service';

const zone = (id: string, kind: ZoneKind) =>
  ({ id, kind, polygon: rectangle([108.4415, 11.953], 40, 40) }) as ZoneEntity;

/** A service over fakes: only what `tick` reads. The config and the leader are not used by it. */
function simulatorOver(zones: ZoneEntity[]) {
  const report = jest.fn().mockResolvedValue(undefined);
  const incidents = {
    countBy: jest.fn().mockResolvedValue(0),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const service = new SimulatorService(
    {} as never,
    { report } as unknown as IncidentsService,
    incidents as unknown as Repository<IncidentEntity>,
    { find: jest.fn().mockResolvedValue(zones) } as unknown as Repository<ZoneEntity>,
    {} as never,
  );
  const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  return { service, report, warn };
}

describe('SimulatorService.tick', () => {
  it('reports in a zone a scenario covers when `random` points at one none does', async () => {
    const { service, report, warn } = simulatorOver([
      zone('lake', 'water'),
      zone('plant', 'utility'),
      zone('hall', 'building'),
    ]);

    // `() => 0` picks the first zone it is offered: the lake, before the guard.
    await service.tick(() => 0);

    expect(warn).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toMatchObject({ zoneId: 'hall' });
  });

  it('reports nothing, and does not warn, when no zone has a scenario', async () => {
    const { service, report, warn } = simulatorOver([
      zone('lake', 'water'),
      zone('plant', 'utility'),
    ]);

    await service.tick(() => 0);

    expect(report).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

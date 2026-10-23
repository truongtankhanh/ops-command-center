import { useMemo } from 'react';
import { useAssets, useIncidents, useZones } from '../api/queries';
import { assetStates } from '../lib/assets/assets';
import { assetsText, buildingEyebrow, buildingSummary, incidentsText } from '../lib/twinBuilding';
import { buildingReadings, tempText } from '../lib/twinHeat';
import { levelOf } from '../lib/twinLevel';
import { useServerNow, useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import styles from './BuildingSummary.module.css';

const NO_INCIDENTS: never[] = [];

/**
 * The card of the building in focus (V2-15.9, frame 12 `.tw-callout`, ADR-0020 "Settled in V2-15.1" and "V2-15.9"):
 * what it is, and three rows an operator wants before opening anything: how many assets it holds and whether all of
 * them report, how many incidents are open and the first one, and the indoor temperature. No "IT load" and no
 * "Power": no point is a building's load, and `powerSource` is not a headline.
 *
 * Every figure is the Assets tab's or the feed's own (`lib/twinBuilding.ts` composes their rules), so the card and
 * the lists cannot disagree (brief § Principle 1). It is shown at building level only: at asset and part level the
 * inspector carries the asset and V2-15.10's callout the part. The same for every role: it reads no permission.
 *
 * - **Nothing is said that is not known.** While the zone, the catalogue or the zones are on their way there is no
 *   card; while the incident list has not loaded the incidents row is left out rather than read as "None", which
 *   would tell an operator the building is quiet (as `twinSummary` leaves an unknown count out). The indoor row is
 *   left out when the building has no fresh reading (silent): it is the heat overlay's own number
 *   (`lib/twinHeat.ts`, V2-17.2), so the two cannot disagree; the overlay's "No data" is its label, not a row here.
 * - **A named region, not a live region.** The figures change every second, and a new incident is announced by the
 *   feed and the toasts; the stage's own summary is no live region either (`TwinView`).
 * - **Where it stands:** frame 12's top right, offset by the open sheet (`--sheet-inset`) as the camera controls are,
 *   so an incident opened while a building is in focus never covers it.
 */
export function BuildingSummary() {
  const level = useConsole((state) => levelOf(state));
  const focusZoneId = useConsole((state) => state.focusZoneId);
  const zones = useZones();
  const assets = useAssets();
  const incidents = useIncidents();
  const overview = useTelemetryStore((state) => state.view.state.assets);
  const serverNow = useServerNow();

  const zone = zones.data?.find((candidate) => candidate.id === focusZoneId);
  const figures = useMemo(() => {
    if (zone === undefined || assets.data === undefined) return null;
    const raised = incidents.data ?? NO_INCIDENTS;
    const states = assetStates(assets.data, raised, overview, serverNow);
    const reading = buildingReadings([zone], assets.data, overview, serverNow).get(zone.id);
    return buildingSummary(zone, assets.data, states, raised, reading);
  }, [zone, assets.data, incidents.data, overview, serverNow]);

  if (level !== 'building' || zone === undefined || figures === null) return null;
  return (
    <section className={styles.card} aria-label={`${zone.name} summary`}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>{buildingEyebrow(zone)}</p>
        <p className={styles.name}>{zone.name}</p>
      </div>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>Assets</dt>
          <dd>{assetsText(figures.assets)}</dd>
        </div>
        {incidents.data !== undefined && (
          <div className={styles.row}>
            <dt>Open incidents</dt>
            <dd>{incidentsText(figures.incidents)}</dd>
          </div>
        )}
        {figures.indoorC !== null && (
          <div className={styles.row}>
            <dt>Indoor</dt>
            <dd>{tempText(figures.indoorC)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

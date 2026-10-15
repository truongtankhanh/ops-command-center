import type { Asset } from '@occ/contracts';
import { useZones } from '../api/queries';
import { usePermission } from '../auth/usePermission';
import { reportPresetOf } from '../lib/assetReport';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Flag } from '../ui/icons';
import styles from './AssetFoot.module.css';
import { ViewOnlyNote } from './ViewOnlyNote';

/**
 * The foot of the asset inspector (frames 03, 17). A user who may report gets "Report a fault on
 * CT-01", which opens the report form already on Facilities / Equipment fault, in the asset's zone
 * (`reportPresetOf`); anyone else gets the view-only note in its place, so the sheet never ends in
 * a gap. The console only hides what a role cannot do: the API's `403` is the control (ADR-0011).
 *
 * The row is the slot for "Focus" (V2-12), which is not built and has no key: it is added to this
 * row, as a `flex: none` button, without moving the report button's place.
 *
 * Reporting from here does not link the incident to the asset (the request has no `assetId`), so
 * the form's title carries the asset's tag; the inspector will not list the new incident.
 */
export function AssetFoot({
  asset,
}: {
  asset: Pick<Asset, 'code' | 'name' | 'zoneId' | 'position'>;
}) {
  const canReport = usePermission('incident:report');
  const { data: zones } = useZones();
  const startReport = useConsole((s) => s.startReport);

  if (!canReport) {
    return (
      <ViewOnlyNote>
        <strong>View only</strong> Readings, parts and cameras are all yours to explore. Reporting a
        fault needs the operator, supervisor or technician role.
      </ViewOnlyNote>
    );
  }
  return (
    <div className={styles.foot}>
      {/*
        `primary`: it is the only action in the sheet, and `secondary` fails 3:1 on this foot's
        `--surface-2` (`Button`). Frame 03 draws a secondary one; `IncidentResponse` meets the same.
      */}
      <Button
        variant="primary"
        icon={Flag}
        className={styles.report}
        onClick={() => startReport(reportPresetOf(asset, zones))}
      >
        {`Report a fault on ${asset.code}`}
      </Button>
    </div>
  );
}

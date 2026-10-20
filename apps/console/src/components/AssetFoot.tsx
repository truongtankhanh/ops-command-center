import type { Asset } from '@occ/contracts';
import { useZones } from '../api/queries';
import { usePermission } from '../auth/usePermission';
import { reportPresetOf } from '../lib/assetReport';
import { focusAvailable, focusSelection } from '../lib/twinFocus';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Crosshair, Flag } from '../ui/icons';
import styles from './AssetFoot.module.css';
import { ViewOnlyNote } from './ViewOnlyNote';

/**
 * The foot of the asset inspector (frames 03, 17). A user who may report gets "Report a fault on
 * CT-01", which opens the report form already on Facilities / Equipment fault, in the asset's zone
 * (`reportPresetOf`); anyone else gets the view-only note in its place, so the sheet never ends in
 * a gap. The console only hides what a role cannot do: the API's `403` is the control (ADR-0011).
 *
 * "Focus" (V2-15.11) is the row's second control, for every role: it flies the 3D camera to the selected part, else
 * to the asset (`focusSelection`). It is drawn in the 3D view only and only for an asset the scene draws
 * (`focusAvailable`). It is a `flex: none` button after the report button, which keeps its place and its growth; a
 * viewer's note keeps its text and gains the button at its end (`ViewOnlyNote`'s `action`). It carries the `F` hint
 * while single-key shortcuts are on (V2-18.2): `F` with this asset selected flies to the selected part, else to the
 * asset, which is what the button does (`TwinShortcuts` owns the key).
 *
 * Reporting from here does not link the incident to the asset (the request has no `assetId`), so
 * the form's title carries the asset's tag; the inspector will not list the new incident.
 */
export function AssetFoot({
  asset,
}: {
  asset: Pick<Asset, 'code' | 'name' | 'zoneId' | 'position' | 'elevationM'>;
}) {
  const canReport = usePermission('incident:report');
  const { data: zones } = useZones();
  const startReport = useConsole((s) => s.startReport);
  const view = useConsole((s) => s.view);
  const focusZoneId = useConsole((s) => s.focusZoneId);
  const selectedPart = useConsole((s) => s.selectedPart);
  const keysOn = useConsole((s) => s.keyboardShortcuts);

  const canFocus = focusAvailable({
    view,
    asset,
    zone: zones?.find((zone) => zone.id === asset.zoneId),
    focusZoneId,
    selectedPart,
  });
  const focus = canFocus ? (
    <Button
      variant="ghost"
      icon={Crosshair}
      shortcut={keysOn ? 'F' : undefined}
      className={styles.focus}
      onClick={() => focusSelection(asset.code, useConsole.getState().selectedPart)}
    >
      Focus
    </Button>
  ) : undefined;

  if (!canReport) {
    return (
      <ViewOnlyNote action={focus}>
        <strong>View only</strong> Readings, parts and cameras are all yours to explore. Reporting a
        fault needs the operator, supervisor or technician role.
      </ViewOnlyNote>
    );
  }
  return (
    <div className={styles.foot}>
      {/*
        `primary`: it is the sheet's only primary action, and `secondary` fails 3:1 on this foot's
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
      {focus}
    </div>
  );
}

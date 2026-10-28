import type { Camera } from '@occ/contracts';
import { useId, useState } from 'react';
import {
  CAMERA_FILTERS,
  type CameraFilter,
  countCameras,
  filterCameras,
} from '../../lib/cameras/cameraFilter';
import { cameraLink, prioritise, type StripSubject } from '../../lib/cameras/cameras';
import text from '../../styles/text.module.css';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Tabs } from '../../ui/Tabs';
import styles from './CameraGrid.module.css';
import { CameraTile } from './CameraTile';

/**
 * Every camera of the site in one dialog (frame 13d, V3-08.4), opened by the strip's "View all": the
 * strip stays a shortlist of four, six or eight. The same All / Live / Offline filter as the strip's,
 * over the same tiles, so each one keeps its two actions; a tile's "open in the viewer" opens
 * `CameraViewer`, which is mounted once in `App` and stacks above this dialog, so closing the viewer
 * returns to the grid.
 *
 * The list and the `subject` (the selected incident's zone or asset) come from the strip, which has
 * both, so this component asks for nothing and the ring and tag on a tile say what they say in the
 * strip. The order is `prioritise` alone, not the strip's pins-first order: pinning here must not
 * move a tile from under the operator's focus, and the pinned badge already shows a pin.
 *
 * The filter is this component's own state, so each opening starts at All. The frame draws the title,
 * chips and close in one header row; `Dialog` has a title, a body and a row of actions, so the chips
 * sit under the title and Close at the foot (as in the viewer).
 */
export function CameraGrid({
  cameras,
  subject,
  onClose,
}: {
  cameras: Camera[];
  subject: StripSubject | undefined;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<CameraFilter>('all');
  const summaryId = useId();
  const counts = countCameras(cameras);
  const shown = prioritise(filterCameras(cameras, filter), subject);

  return (
    <Dialog
      size="wide"
      title="All cameras"
      describedBy={summaryId}
      onCancel={onClose}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {/* The dialog's short description: without it the whole grid would be read out on opening. */}
      <p id={summaryId} className={styles.summary}>
        {counts.all} {counts.all === 1 ? 'camera' : 'cameras'} on this site
      </p>
      {counts.all > 0 ? (
        <Tabs
          // Not the strip's "Filter cameras": both tablists are in the document while this is open.
          label="Filter all cameras"
          tabs={CAMERA_FILTERS.map(({ value, label }) => ({ value, label, count: counts[value] }))}
          value={filter}
          onChange={setFilter}
          appearance="chips"
          className={styles.tabs}
        >
          {shown.length === 0 ? (
            <p className={`${text.muted} ${styles.message}`}>No {filter} cameras.</p>
          ) : (
            <div className={styles.tiles}>
              {shown.map((camera) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  link={cameraLink(camera, subject) ?? undefined}
                />
              ))}
            </div>
          )}
        </Tabs>
      ) : (
        <p className={`${text.muted} ${styles.message}`}>No cameras are set up on this site.</p>
      )}
    </Dialog>
  );
}

import type { Camera } from '@occ/contracts';
import { useId } from 'react';
import { useCameras, useStream, useZones } from '../api/queries';
import { canPin, feedState, STRIP_SIZE } from '../lib/cameras';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Maximize2, Pin, PinOff } from '../ui/icons';
import { CameraFeed } from './CameraFeed';
import { CameraTime } from './CameraTime';
import styles from './CameraTile.module.css';

const STRIP_FULL = `The strip holds ${STRIP_SIZE} pinned cameras. Unpin one first.`;

/**
 * A camera with the chrome of frames 01 / 02 / 06: LIVE, the code or an "In zone" tag, a pinned
 * badge, the name, zone and time, and two actions shown on hover or focus — open in the viewer and
 * pin to the strip. `compact` is the detail sheet's tile: LIVE and the name only (frames 02 / 06).
 */
export function CameraTile({
  camera,
  variant = 'strip',
  linked = false,
}: {
  camera: Camera;
  variant?: 'strip' | 'compact';
  /** In the selected incident's zone: accent ring and "In zone" tag (frame 02). */
  linked?: boolean;
}) {
  const stream = useStream(camera);
  const { data: zones = [] } = useZones();
  const { data: cameras = [] } = useCameras();
  const pinnedIds = useConsole((s) => s.pinnedCameraIds);
  const openViewer = useConsole((s) => s.openViewer);
  const toggleCameraPin = useConsole((s) => s.toggleCameraPin);
  const fullHintId = useId();

  const compact = variant === 'compact';
  const live = feedState(camera.online, stream) === 'stream';
  const zoneName = zones.find((z) => z.id === camera.zoneId)?.name;
  const knownIds = cameras.map((c) => c.id);
  const pinned = pinnedIds.includes(camera.id);
  const pinnable = canPin(pinnedIds, camera.id, knownIds);
  // The tag takes the code's place, so the code moves to the zone line (frame 02).
  const zoneLine = [zoneName, linked ? camera.code : null].filter(Boolean).join(' · ');

  return (
    <figure className={styles.tile} data-linked={linked || undefined}>
      <CameraFeed camera={camera} />

      <div className={styles.top}>
        <span className={styles.badges}>
          {live && <LivePill />}
          {!compact && pinned && (
            <span className={styles.pill} aria-hidden="true">
              <Icon glyph={Pin} size={14} />
            </span>
          )}
        </span>
        {linked ? (
          <span className={styles.tag}>In zone</span>
        ) : (
          !(compact && live) && <span className={styles.pill}>{camera.code}</span>
        )}
      </div>

      <div className={styles.actions}>
        <Button
          variant="ghost"
          className={styles.action}
          aria-label={`Open ${camera.code} in the viewer`}
          onClick={() => openViewer(camera.id)}
        >
          <Icon glyph={Maximize2} size={16} />
        </Button>
        <Button
          variant="ghost"
          className={styles.action}
          aria-label={pinned ? `Unpin ${camera.code}` : `Pin ${camera.code} to the strip`}
          aria-disabled={!pinnable || undefined}
          aria-describedby={pinnable ? undefined : fullHintId}
          title={pinnable ? undefined : STRIP_FULL}
          onClick={() => {
            if (pinnable) toggleCameraPin(camera.id, knownIds);
          }}
        >
          <Icon glyph={pinned ? PinOff : Pin} size={16} />
        </Button>
        {!pinnable && (
          <span id={fullHintId} className={styles.hidden}>
            {STRIP_FULL}
          </span>
        )}
      </div>

      <figcaption className={styles.caption}>
        <span className={styles.names}>
          <span className={styles.name}>{camera.name}</span>
          {!compact && zoneLine && <span className={styles.secondary}>{zoneLine}</span>}
        </span>
        {!compact && live && <CameraTime className={styles.secondary} />}
      </figcaption>
    </figure>
  );
}

/** Frame 01's LIVE pill; also over the camera viewer's picture. */
export function LivePill() {
  return (
    <span className={`${styles.pill} ${styles.live}`}>
      <i className={styles.dot} aria-hidden="true" />
      LIVE
    </span>
  );
}

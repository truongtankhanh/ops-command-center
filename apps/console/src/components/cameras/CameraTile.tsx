import type { Camera } from '@occ/contracts';
import { useId } from 'react';
import { useCameras, useStream, useZones } from '../../api/queries';
import { canPin, type CameraLink, feedState, PIN_LIMIT } from '../../lib/cameras/cameras';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Maximize2, Pin, PinOff } from '../../ui/icons';
import { CameraFeed } from './CameraFeed';
import { CameraTime } from './CameraTime';
import styles from './CameraTile.module.css';

const STRIP_FULL = `You can pin ${PIN_LIMIT} cameras to the strip. Unpin one first.`;

/** The word of the tag, by why the camera is tied to the selection (frames 02, 03). */
const LINK_TAG: Readonly<Record<CameraLink, string>> = {
  asset: 'On this asset',
  zone: 'In zone',
};

/**
 * A camera with the chrome of frames 01 / 02 / 03 / 06 / 13: LIVE (or OFFLINE, on the strip's tile
 * only), the code or a tag, a pinned badge, the name, zone and time, and two actions shown on hover
 * or focus — open in the viewer and pin to the strip. `compact` is the detail sheet's tile: LIVE and
 * the name only (frames 02 / 06).
 */
export function CameraTile({
  camera,
  variant = 'strip',
  link,
  tag,
  readOnly = false,
}: {
  camera: Camera;
  variant?: 'strip' | 'compact';
  /**
   * Why the camera is tied to the selection: it is in the selected incident's zone, or the selected
   * asset's (`zone`: "In zone", frame 02), or it sees the selected asset (`asset`: "On this asset",
   * frame 03). Either draws the accent ring. Absent: an ordinary tile.
   */
  link?: CameraLink;
  /** The words of the tag in place of `link`'s ("INC-000107" on the video wall); needs a `link`. */
  tag?: string;
  /**
   * The video wall's tile (V2-21.4): the picture, the labels and the time, and nothing to press: no pin, no
   * pinned badge and no button to open the viewer.
   */
  readOnly?: boolean;
}) {
  const stream = useStream(camera);
  const { data: zones = [] } = useZones();
  const { data: cameras = [] } = useCameras();
  const pinnedIds = useConsole((s) => s.pinnedCameraIds);
  const openViewer = useConsole((s) => s.openViewer);
  const toggleCameraPin = useConsole((s) => s.toggleCameraPin);
  const fullHintId = useId();

  const compact = variant === 'compact';
  const state = feedState(camera.online, stream);
  const live = state === 'stream';
  // A camera that is online but whose stream cannot be had is not offline: the notice says so.
  const offline = state === 'offline';
  const zoneName = zones.find((z) => z.id === camera.zoneId)?.name;
  const knownIds = cameras.map((c) => c.id);
  const pinned = pinnedIds.includes(camera.id);
  const pinnable = canPin(pinnedIds, camera.id, knownIds);
  // The tag takes the code's place, so the code moves to the zone line (frame 02).
  const zoneLine = [zoneName, link ? camera.code : null].filter(Boolean).join(' · ');

  return (
    <figure className={styles.tile} data-linked={link} data-readonly={readOnly || undefined}>
      <CameraFeed camera={camera} readOnly={readOnly} />

      <div className={styles.top}>
        <span className={styles.badges}>
          {live && <LivePill />}
          {offline && !compact && !readOnly && <OfflinePill />}
          {!compact && !readOnly && pinned && (
            <span className={styles.pill} aria-hidden="true">
              <Icon glyph={Pin} size={14} />
            </span>
          )}
        </span>
        {link ? (
          <span className={styles.tag}>{tag ?? LINK_TAG[link]}</span>
        ) : (
          !(compact && live) && <span className={styles.pill}>{camera.code}</span>
        )}
      </div>

      {!readOnly && (
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
      )}

      <figcaption className={styles.caption}>
        <span className={styles.names}>
          <span className={styles.name} title={camera.name}>
            {camera.name}
          </span>
          {!compact && zoneLine && (
            <span className={styles.secondary} title={zoneLine}>
              {zoneLine}
            </span>
          )}
        </span>
        {!compact && live && <CameraTime className={styles.secondary} />}
      </figcaption>
    </figure>
  );
}

/**
 * Frame 13's OFFLINE pill, in LIVE's place on the strip's tile: the word and a ring where LIVE has a filled dot, so
 * the state is not told by colour alone. Hidden from assistive tech because the "no picture" notice under it already
 * says "No signal" and "Camera offline"; it is for the eye, as the pinned badge is.
 */
function OfflinePill() {
  return (
    <span className={styles.pill} data-state="offline" aria-hidden="true">
      <i className={styles.dot} aria-hidden="true" />
      Offline
    </span>
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

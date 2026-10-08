import { formatCameraTime } from '../lib/cameras';
import { useNow } from '../lib/useNow';

/**
 * The time on a camera frame, ticking every second. Its own component so that only this `<time>`
 * re-renders each second, not the tile or the canvas under it.
 */
export function CameraTime({ className }: { className?: string }) {
  const now = useNow(1000);
  return (
    <time dateTime={new Date(now).toISOString()} className={className}>
      {formatCameraTime(now)}
    </time>
  );
}

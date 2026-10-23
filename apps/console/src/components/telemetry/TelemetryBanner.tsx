import { useEffect, useState } from 'react';
import type { TelemetryPillState } from '../../lib/telemetry/telemetryState';
import { formatClockTimeSeconds } from '../../lib/shared/time';
import { useTelemetryStatus } from '../../realtime/telemetryStore';
import { retryTelemetry } from '../../realtime/useTelemetry';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { connectionIcon, telemetryIcon } from '../../ui/icons';

/** How long "Reconnect" stays disabled after a press (V2-08.1), so a stuck link is not hammered. */
const RECONNECT_COOLDOWN_MS = 5000;

const STILL_LIVE = 'Incidents and cameras are still live.';

/**
 * The pill's two states that say readings may be old, with the copy V2-08.1 settled. A time that is
 * missing or unparseable becomes `NaN`: the sentence then loses its "since …" instead of showing
 * "Invalid Date".
 */
function bannerCopy(
  pill: TelemetryPillState,
  upstreamSince: string | null,
  socketSince: number | null,
): { message: string; detail: string } | null {
  const since = (at: number) => (Number.isNaN(at) ? '' : ` since ${formatClockTimeSeconds(at)}`);
  switch (pill) {
    case 'paused': {
      // The API's own time, as it said it (`telemetry.status`), never this browser's clock.
      const pausedAt = upstreamSince === null ? NaN : Date.parse(upstreamSince);
      return {
        message: `Telemetry paused${since(pausedAt)}`,
        detail: `Readings hold their last value and stop updating. ${STILL_LIVE}`,
      };
    }
    case 'reconnecting':
      // This console's own socket, so its own clock is the one that knows when it was lost.
      return {
        message: `Telemetry connection lost${since(socketSince ?? NaN)}`,
        detail:
          'Reconnecting automatically. Readings hold their last value until it is back. ' +
          STILL_LIVE,
      };
    default:
      // Nothing to say while connecting or live. `unavailable` has no banner on purpose: one
      // reconnect can meet an older replica during a rolling deploy (V2-08.1), and the Assets tab
      // says so where readings would be.
      return null;
  }
}

/**
 * Frame 05: while the API's source is paused, or this console's own `/telemetry` socket is down,
 * readings hold their last value. Mounted only for as long as that is true (as `OfflineBanner`), so
 * it is announced once and clears by itself. It says nothing about incidents or cameras except that
 * they are live: those come over the `/events` socket, which has its own pill and banner. `App`
 * stacks the two.
 */
export function TelemetryBanner() {
  const { pill, upstreamSince, socketSince } = useTelemetryStatus();
  const copy = bannerCopy(pill, upstreamSince, socketSince);
  if (copy === null) return null;
  return (
    <Banner
      role="status"
      icon={telemetryIcon(pill)}
      detail={copy.detail}
      // The same element in both states, so a press that turns `paused` into `reconnecting` (the
      // engine says so at once) does not restart the cooldown.
      action={<ReconnectButton />}
    >
      {copy.message}
    </Banner>
  );
}

/**
 * Reconnects the telemetry socket only; it cannot restart the API's own link to its source, and
 * the copy does not promise that. Disabled for a few seconds after a press, with the plain
 * `disabled` of `Button`: it is the one the primitive draws, and `aria-disabled` would look
 * enabled.
 * The cost is that keyboard focus falls back to the page; supporting `aria-disabled` in `Button`
 * is a change to a primitive every screen uses, so it is its own task.
 */
function ReconnectButton() {
  const [cooling, setCooling] = useState(false);

  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(() => setCooling(false), RECONNECT_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [cooling]);

  return (
    <Button
      size="sm"
      icon={connectionIcon('connecting')}
      disabled={cooling}
      onClick={() => {
        retryTelemetry();
        setCooling(true);
      }}
    >
      Reconnect
    </Button>
  );
}

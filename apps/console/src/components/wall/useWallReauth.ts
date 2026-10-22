import { useEffect, useState } from 'react';
import { reauthenticate } from '../../auth/session';
import { useSession } from '../../auth/store';
import {
  clearReauth,
  readReauth,
  reauthDelay,
  recordAttempt,
  writeReauth,
} from '../../lib/wall/wallReauth';

/**
 * Signs an unattended video wall in again (V2-21.10). Mounted by `AuthGate` while a wall's session has failed (a renewal
 * that failed, or a sign-in that did not complete) and nobody is there to press "Sign in again". Each round waits what
 * `reauthDelay` says (none for the first of a run, then a minute or more, backing off), records the attempt **before**
 * leaving, because the page is gone after the redirect and the record in the tab's storage is what the next page reads,
 * and then runs `reauthenticate`: a renewal, then the sign-in if the identity provider answers. If nothing took the page
 * away, the next round is scheduled.
 *
 * The run is forgotten when this unmounts because the session healed in this page; leaving through the redirect never
 * runs a cleanup, so the record survives it and a loop of fast failures keeps backing off.
 */
export function useWallReauth(): void {
  const [round, setRound] = useState(0);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        writeReauth(recordAttempt(readReauth(), Date.now()));
        void reauthenticate().finally(() => setRound((n) => n + 1));
      },
      reauthDelay(readReauth(), Date.now()),
    );
    return () => clearTimeout(timer);
  }, [round]);

  useEffect(
    () => () => {
      const { status, expired } = useSession.getState();
      if (status === 'signed-in' && !expired) clearReauth();
    },
    [],
  );
}

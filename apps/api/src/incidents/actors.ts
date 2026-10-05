import type { Actor } from '@occ/contracts';
import type { AuthenticatedUser } from '../auth/token-verifier';

/**
 * The actors the API records on the timeline (ADR-0011). An actor comes only from a verified
 * token or from this file, never from request input. Entries written before actors existed carry
 * `system` / `System`, set by the migration that added them.
 */

/** Changes the API makes on its own. */
export const SystemActors = {
  simulator: { kind: 'system', subject: 'simulator', displayName: 'Simulator' },
  seed: { kind: 'system', subject: 'seed', displayName: 'Demo seed' },
} as const satisfies Record<string, Actor>;

/** Length of `incident_event.actor_name`, which Postgres counts in characters. */
const MAX_DISPLAY_NAME_LENGTH = 255;

/**
 * The signed-in user as a timeline actor. The display name is only a label, so a longer one is
 * cut to fit. The subject is never cut: cutting it could make two people share one subject.
 */
export function userActor(user: AuthenticatedUser): Actor {
  const characters = [...user.displayName];
  const displayName =
    characters.length > MAX_DISPLAY_NAME_LENGTH
      ? characters.slice(0, MAX_DISPLAY_NAME_LENGTH).join('')
      : user.displayName;
  return { kind: 'user', subject: user.subject, displayName };
}

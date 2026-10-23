import { type Role, ROLES } from '@occ/contracts';

const ROLE_LABELS: Record<Role, string> = {
  operator: 'Operator',
  supervisor: 'Supervisor',
  technician: 'Technician',
  viewer: 'Viewer',
};

/** The user's roles as one label, in `ROLES` order: "Operator", "Operator · Supervisor". */
export const rolesLabel = (roles: readonly Role[]): string =>
  ROLES.filter((role) => roles.includes(role))
    .map((role) => ROLE_LABELS[role])
    .join(' · ');

/**
 * Up to two letters for an avatar: the first letters of the first and last word ("Demo Operator"
 * → "DO"); one word gives one letter. Letters are taken by code point, so a name outside the Basic
 * Multilingual Plane is not cut in half.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const ends = words.length > 1 ? [words[0], words.at(-1)] : words;
  return ends.map((word) => Array.from(word ?? '')[0]?.toUpperCase() ?? '').join('');
}

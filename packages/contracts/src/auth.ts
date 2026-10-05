/**
 * Roles and what they allow (ADR-0011). The API enforces this map; the console reads the same
 * map only to hide actions a user cannot take, so the two cannot drift.
 */

/** Realm roles the API recognises. Any other role in a token is ignored. */
export const ROLES = ['operator', 'supervisor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Actions that need more than reading. Reading only needs one of `ROLES`. */
export const PERMISSIONS = ['incident:report', 'incident:acknowledge', 'incident:resolve'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** `supervisor` has the same rights as `operator` until supervisor-only actions are defined. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  operator: PERMISSIONS,
  supervisor: PERMISSIONS,
  viewer: [],
};

export const hasPermission = (roles: readonly Role[], permission: Permission): boolean =>
  roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));

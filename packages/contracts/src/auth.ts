/**
 * Roles and what they allow (ADR-0011, ADR-0021). The API enforces these maps; the console reads
 * the same maps only to hide actions a user cannot take, so the two cannot drift.
 */
import type { IncidentCategory } from './domain';

/** Realm roles the API recognises. Any other role in a token is ignored. */
export const ROLES = ['operator', 'supervisor', 'technician', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Actions that need more than reading. Reading only needs one of `ROLES`. */
export const PERMISSIONS = ['incident:report', 'incident:acknowledge', 'incident:resolve'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * `supervisor` has the same rights as `operator` until supervisor-only actions are defined.
 * `technician` holds every permission, but acknowledges and resolves only within
 * `ROLE_CATEGORY_SCOPE`: the API checks the incident's category once it has loaded it, so
 * `hasPermission` alone is not enough for those two (use `hasPermissionFor`).
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  operator: PERMISSIONS,
  supervisor: PERMISSIONS,
  technician: PERMISSIONS,
  viewer: [],
};

/** The incident categories a role may acknowledge and resolve (ADR-0021). */
export const ROLE_CATEGORY_SCOPE: Readonly<Record<Role, readonly IncidentCategory[] | 'all'>> = {
  operator: 'all',
  supervisor: 'all',
  technician: ['facilities', 'environment'],
  viewer: [],
};

/** Reporting is never scoped: anyone who may report may report any category. */
const CATEGORY_SCOPED: readonly Permission[] = ['incident:acknowledge', 'incident:resolve'];

export const hasPermission = (roles: readonly Role[], permission: Permission): boolean =>
  roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));

/**
 * Whether one of `roles` grants `permission` on an incident of `category`: the role holds the
 * permission and, for acknowledge and resolve, its scope is `'all'` or includes the category.
 */
export const hasPermissionFor = (
  roles: readonly Role[],
  permission: Permission,
  category: IncidentCategory,
): boolean =>
  roles.some((role) => {
    if (!ROLE_PERMISSIONS[role].includes(permission)) return false;
    if (!CATEGORY_SCOPED.includes(permission)) return true;
    const scope = ROLE_CATEGORY_SCOPE[role];
    return scope === 'all' || scope.includes(category);
  });

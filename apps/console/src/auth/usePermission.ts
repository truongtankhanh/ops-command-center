import {
  hasPermission,
  hasPermissionFor,
  INCIDENT_CATEGORIES,
  type IncidentCategory,
  type Permission,
  PERMISSIONS,
  type Role,
} from '@occ/contracts';
import { useSession } from './store';

/**
 * Whether the signed-in user's roles grant `permission`, read from the same `ROLE_PERMISSIONS`
 * the API enforces. For hiding actions only: the API's 403 is the control (ADR-0011).
 */
export const usePermission = (permission: Permission): boolean =>
  useSession((s) => hasPermission(s.user?.roles ?? [], permission));

/**
 * Whether `roles` grant `permission` on an incident of `category`. `null` is a type this console
 * does not know (`categoryOfType`), so its category is unknown: it is allowed only where the
 * permission holds for every category (a role with scope `'all'`, or a permission not limited by
 * category), and a limited scope such as a technician's fails closed (ADR-0021).
 */
const mayOn = (
  roles: readonly Role[],
  permission: Permission,
  category: IncidentCategory | null,
): boolean =>
  category === null
    ? INCIDENT_CATEGORIES.every((known) => hasPermissionFor(roles, permission, known))
    : hasPermissionFor(roles, permission, category);

/**
 * `usePermission` on an incident of `category`, read from the same `ROLE_CATEGORY_SCOPE` the API
 * enforces (ADR-0021). `null`, a type this console does not know, is allowed only to a role that
 * may act on every category: an operator still acts on a type newer than this build, a technician
 * only views it. For hiding actions only: the API's 403 is the control.
 */
export const usePermissionFor = (
  permission: Permission,
  category: IncidentCategory | null,
): boolean => useSession((s) => mayOn(s.user?.roles ?? [], permission, category));

/** The user may read but take no action, whichever role made it so. */
export const useReadOnly = (): boolean =>
  useSession(
    (s) => !PERMISSIONS.some((permission) => hasPermission(s.user?.roles ?? [], permission)),
  );

import {
  hasPermission,
  hasPermissionFor,
  type IncidentCategory,
  type Permission,
  PERMISSIONS,
} from '@occ/contracts';
import { useSession } from './store';

/**
 * Whether the signed-in user's roles grant `permission`, read from the same `ROLE_PERMISSIONS`
 * the API enforces. For hiding actions only: the API's 403 is the control (ADR-0011).
 */
export const usePermission = (permission: Permission): boolean =>
  useSession((s) => hasPermission(s.user?.roles ?? [], permission));

/**
 * `usePermission` on an incident of `category`, read from the same `ROLE_CATEGORY_SCOPE` the API
 * enforces (ADR-0021). `null`, a type this console does not know (`categoryOfType`), is out of
 * every scope. For hiding actions only: the API's 403 is the control.
 */
export const usePermissionFor = (
  permission: Permission,
  category: IncidentCategory | null,
): boolean =>
  useSession(
    (s) => category !== null && hasPermissionFor(s.user?.roles ?? [], permission, category),
  );

/** The user may read but take no action, whichever role made it so. */
export const useReadOnly = (): boolean =>
  useSession(
    (s) => !PERMISSIONS.some((permission) => hasPermission(s.user?.roles ?? [], permission)),
  );

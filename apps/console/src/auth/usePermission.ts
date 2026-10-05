import { hasPermission, type Permission, PERMISSIONS } from '@occ/contracts';
import { useSession } from './store';

/**
 * Whether the signed-in user's roles grant `permission`, read from the same `ROLE_PERMISSIONS`
 * the API enforces. For hiding actions only: the API's 403 is the control (ADR-0011).
 */
export const usePermission = (permission: Permission): boolean =>
  useSession((s) => hasPermission(s.user?.roles ?? [], permission));

/** The user may read but take no action, whichever role made it so. */
export const useReadOnly = (): boolean =>
  useSession(
    (s) => !PERMISSIONS.some((permission) => hasPermission(s.user?.roles ?? [], permission)),
  );

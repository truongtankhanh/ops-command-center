import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '@occ/contracts';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSION_KEY, type RequestWithUser } from './auth.decorators';

/**
 * Global guard (ADR-0011), registered after `AuthGuard` so it sees the authenticated user and an
 * unauthenticated request still gets 401 first. Deny by default: a user with none of the known
 * roles gets 403 everywhere, and a handler's `@RequirePermission()` must be granted by one of the
 * user's roles. Guards run before pipes, so the 403 comes before any 400 or 404.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;
    // Same rule as `AuthGuard`: `/events` checks roles in its handshake and has no handlers.
    if (context.getType() !== 'http') return false;

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    // `AuthGuard` sets it on every non-public route; missing means the guards were reordered.
    if (!user) return false;
    if (user.roles.length === 0) throw new ForbiddenException('No role grants access to this API');

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION_KEY,
      targets,
    );
    if (permission && !hasPermission(user.roles, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return true;
  }
}

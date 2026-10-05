import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, type Role } from '@occ/contracts';
import { Public, RequirePermission } from './auth.decorators';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from './token-verifier';

/** Handlers decorated the way the real controllers are, so the guard reads real metadata. */
class ProbeController {
  @Public()
  health() {}

  read() {}

  @RequirePermission('incident:acknowledge')
  acknowledge() {}
}

@RequirePermission('incident:report')
class ReportOnlyController {
  report() {}
}

const userWith = (...roles: Role[]): AuthenticatedUser => ({
  subject: 'user-1',
  displayName: 'Demo User',
  roles,
});

interface ContextOptions {
  user?: AuthenticatedUser;
  type?: string;
  controller?: new () => unknown;
}

function contextFor(
  handler: () => void,
  { user, type = 'http', controller = ProbeController }: ContextOptions = {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const { health, read, acknowledge } = ProbeController.prototype;

  it('lets a public route through without a user, whatever the context', () => {
    expect(guard.canActivate(contextFor(health))).toBe(true);
    expect(guard.canActivate(contextFor(health, { type: 'ws' }))).toBe(true);
  });

  it('refuses a non-HTTP context instead of assuming one', () => {
    expect(guard.canActivate(contextFor(read, { type: 'ws', user: userWith('operator') }))).toBe(
      false,
    );
  });

  it('refuses a request with no user, which means the guards were reordered', () => {
    expect(guard.canActivate(contextFor(read))).toBe(false);
  });

  it.each([
    ['a read', read],
    ['a write', acknowledge],
  ])('answers 403 to a user with no known role on %s', (_label, handler) => {
    const run = () => guard.canActivate(contextFor(handler, { user: userWith() }));

    expect(run).toThrow(ForbiddenException);
    expect(run).toThrow('No role grants access to this API');
  });

  it.each<Role>(['viewer', 'operator', 'supervisor'])(
    'lets a %s read without a permission',
    (role) => {
      expect(guard.canActivate(contextFor(read, { user: userWith(role) }))).toBe(true);
    },
  );

  it('answers 403 naming the permission when no role grants it', () => {
    const run = () => guard.canActivate(contextFor(acknowledge, { user: userWith('viewer') }));

    expect(run).toThrow(ForbiddenException);
    expect(run).toThrow('Missing permission: incident:acknowledge');
  });

  it.each<Role>(['operator', 'supervisor'])('lets a %s take a guarded action', (role) => {
    expect(guard.canActivate(contextFor(acknowledge, { user: userWith(role) }))).toBe(true);
  });

  it('grants a permission when any one of the roles has it', () => {
    const user = userWith('operator', 'viewer');

    expect(guard.canActivate(contextFor(acknowledge, { user }))).toBe(true);
  });

  it('reads a permission declared on the controller class', () => {
    const { report } = ReportOnlyController.prototype;
    const context = (role: Role) =>
      contextFor(report, { user: userWith(role), controller: ReportOnlyController });

    expect(guard.canActivate(context('operator'))).toBe(true);
    expect(() => guard.canActivate(context('viewer'))).toThrow(
      'Missing permission: incident:report',
    );
  });

  // The matrix itself (ADR-0011): viewer may do none of the guarded actions.
  it.each(PERMISSIONS)('refuses %s to a viewer', (permission) => {
    class Guarded {
      @RequirePermission(permission)
      act() {}
    }
    const context = contextFor(Guarded.prototype.act, {
      user: userWith('viewer'),
      controller: Guarded,
    });

    expect(() => guard.canActivate(context)).toThrow(`Missing permission: ${permission}`);
  });
});

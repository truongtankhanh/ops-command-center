import { INCIDENT_CATEGORIES, type IncidentCategory, type Role } from '@occ/contracts';
import { act, renderHook } from '@testing-library/react';
import { resetStore } from '../test-utils';
import { useSession } from './store';
import { usePermission, usePermissionFor, useReadOnly } from './usePermission';

function signInAs(...roles: Role[]) {
  act(() => useSession.getState().signedIn({ displayName: 'Signed-in user', roles }));
}

describe('usePermissionFor', () => {
  beforeEach(() => resetStore(useSession));

  it.each<[IncidentCategory, boolean]>([
    ['facilities', true],
    ['environment', true],
    ['security', false],
    ['fire_safety', false],
    ['medical', false],
    ['traffic', false],
  ])('for a technician on %s, acknowledge and resolve are %s', (category, expected) => {
    signInAs('technician');

    const acknowledge = renderHook(() => usePermissionFor('incident:acknowledge', category));
    const resolve = renderHook(() => usePermissionFor('incident:resolve', category));

    expect(acknowledge.result.current).toBe(expected);
    expect(resolve.result.current).toBe(expected);
  });

  it.each<Role>(['operator', 'supervisor'])('lets %s act on every category', (role) => {
    signInAs(role);

    for (const category of INCIDENT_CATEGORIES) {
      const acknowledge = renderHook(() => usePermissionFor('incident:acknowledge', category));
      const resolve = renderHook(() => usePermissionFor('incident:resolve', category));
      expect(acknowledge.result.current).toBe(true);
      expect(resolve.result.current).toBe(true);
    }
  });

  it('does not limit reporting by category', () => {
    signInAs('technician');

    const { result } = renderHook(() => usePermissionFor('incident:report', 'security'));

    expect(result.current).toBe(true);
  });

  it('gives a viewer nothing on any category', () => {
    signInAs('viewer');

    for (const category of INCIDENT_CATEGORIES) {
      const { result } = renderHook(() => usePermissionFor('incident:acknowledge', category));
      expect(result.current).toBe(false);
    }
  });

  // `null` is a type newer than this console: only a role that may act on every category still acts.
  it.each<Role>(['operator', 'supervisor'])('lets %s act on an unknown category (null)', (role) => {
    signInAs(role);

    const acknowledge = renderHook(() => usePermissionFor('incident:acknowledge', null));
    const resolve = renderHook(() => usePermissionFor('incident:resolve', null));

    expect(acknowledge.result.current).toBe(true);
    expect(resolve.result.current).toBe(true);
  });

  it('fails closed for a technician on an unknown category (null)', () => {
    signInAs('technician');

    const acknowledge = renderHook(() => usePermissionFor('incident:acknowledge', null));
    const resolve = renderHook(() => usePermissionFor('incident:resolve', null));

    expect(acknowledge.result.current).toBe(false);
    expect(resolve.result.current).toBe(false);
  });

  it('gives a viewer nothing on an unknown category (null)', () => {
    signInAs('viewer');

    const { result } = renderHook(() => usePermissionFor('incident:acknowledge', null));

    expect(result.current).toBe(false);
  });

  it('takes the widest scope over several roles on an unknown category (null)', () => {
    signInAs('technician', 'operator');

    const { result } = renderHook(() => usePermissionFor('incident:resolve', null));

    expect(result.current).toBe(true);
  });

  it('answers false while nobody is signed in', () => {
    const { result } = renderHook(() => usePermissionFor('incident:resolve', 'facilities'));

    expect(result.current).toBe(false);
  });

  it('follows the signed-in roles as they change', () => {
    const { result } = renderHook(() => usePermissionFor('incident:resolve', 'security'));
    expect(result.current).toBe(false);

    signInAs('operator');
    expect(result.current).toBe(true);

    signInAs('technician');
    expect(result.current).toBe(false);
  });
});

describe('usePermission and useReadOnly for a technician', () => {
  beforeEach(() => resetStore(useSession));

  it('grants acknowledge and resolve before the category is known', () => {
    signInAs('technician');

    const acknowledge = renderHook(() => usePermission('incident:acknowledge'));
    const resolve = renderHook(() => usePermission('incident:resolve'));

    expect(acknowledge.result.current).toBe(true);
    expect(resolve.result.current).toBe(true);
  });

  it('is not read only', () => {
    signInAs('technician');

    const { result } = renderHook(() => useReadOnly());

    expect(result.current).toBe(false);
  });

  it('keeps a viewer read only', () => {
    signInAs('viewer');

    const { result } = renderHook(() => useReadOnly());

    expect(result.current).toBe(true);
  });
});

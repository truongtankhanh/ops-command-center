import {
  categoryOf,
  hasPermission,
  hasPermissionFor,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPE_CATEGORY,
  INCIDENT_TYPE_DEFAULT_SEVERITY,
  INCIDENT_TYPES,
  type IncidentCategory,
  type IncidentType,
  type Permission,
  PERMISSIONS,
  ROLE_CATEGORY_SCOPE,
  ROLES,
  type Role,
} from '@occ/contracts';

// `@occ/contracts` has no test runner, so its category rules (ADR-0021) are proven here, next to the
// guard that enforces its permissions.

/** Every acknowledge / resolve pair over the given categories. */
const scopedActions = (categories: readonly IncidentCategory[]) =>
  (['incident:acknowledge', 'incident:resolve'] as const).flatMap((permission) =>
    categories.map((category): [Permission, IncidentCategory] => [permission, category]),
  );

const everyAction = PERMISSIONS.flatMap((permission) =>
  INCIDENT_CATEGORIES.map((category): [Permission, IncidentCategory] => [permission, category]),
);

describe('hasPermissionFor', () => {
  it.each<Role>(['operator', 'supervisor'])('lets a %s do everything in every category', (role) => {
    for (const [permission, category] of everyAction) {
      expect(hasPermissionFor([role], permission, category)).toBe(true);
    }
  });

  it.each(INCIDENT_CATEGORIES)('lets a technician report a %s incident', (category) => {
    expect(hasPermissionFor(['technician'], 'incident:report', category)).toBe(true);
  });

  it.each(scopedActions(INCIDENT_CATEGORIES))(
    'grants %s on %s when any one of the roles allows it',
    (permission, category) => {
      expect(hasPermissionFor(['technician', 'operator'], permission, category)).toBe(true);
    },
  );

  it.each(scopedActions(['security', 'fire_safety', 'medical', 'traffic']))(
    'refuses a technician %s on a %s incident, outside its scope',
    (permission, category) => {
      expect(hasPermissionFor(['technician'], permission, category)).toBe(false);
    },
  );

  // Fail closed until the API checks the category (V2-03.4): the technician holds only
  // `incident:report` for now. V2-03.4 grants acknowledge and resolve and flips this case to `true`.
  it.each(scopedActions(['facilities', 'environment']))(
    'does not let a technician %s a %s incident yet, even in its scope',
    (permission, category) => {
      expect(hasPermissionFor(['technician'], permission, category)).toBe(false);
    },
  );

  it('refuses a viewer everything in every category', () => {
    for (const [permission, category] of everyAction) {
      expect(hasPermissionFor(['viewer'], permission, category)).toBe(false);
    }
  });

  it.each(PERMISSIONS)('refuses %s to a user with no role', (permission) => {
    expect(hasPermissionFor([], permission, 'facilities')).toBe(false);
  });

  it('is not changed by a role that grants nothing', () => {
    expect(hasPermissionFor(['viewer', 'technician'], 'incident:report', 'security')).toBe(true);
    expect(hasPermissionFor(['viewer', 'technician'], 'incident:acknowledge', 'facilities')).toBe(
      false,
    );
  });

  // Reporting is never scoped, so it must answer exactly as it did before categories existed.
  it.each(ROLES)('answers incident:report for a %s as hasPermission does', (role) => {
    const expected = hasPermission([role], 'incident:report');

    for (const category of INCIDENT_CATEGORIES) {
      expect(hasPermissionFor([role], 'incident:report', category)).toBe(expected);
    }
  });
});

describe('ROLE_CATEGORY_SCOPE', () => {
  it('limits the technician to facilities and environment, as ADR-0021 decides', () => {
    expect(ROLE_CATEGORY_SCOPE).toEqual({
      operator: 'all',
      supervisor: 'all',
      technician: ['facilities', 'environment'],
      viewer: [],
    });
  });

  it('names only known categories', () => {
    const named = Object.values(ROLE_CATEGORY_SCOPE).flatMap((scope) =>
      scope === 'all' ? [] : scope,
    );

    for (const category of named) {
      expect(INCIDENT_CATEGORIES).toContain(category);
    }
  });
});

describe('categoryOf', () => {
  // ADR-0021's table, category by category.
  const ADR_0021: Record<IncidentCategory, IncidentType[]> = {
    security: [
      'intrusion',
      'theft',
      'vandalism',
      'suspicious_object',
      'suspicious_person',
      'assault',
      'crowding',
    ],
    fire_safety: ['fire_alarm', 'fire', 'gas_leak', 'hazmat_spill'],
    medical: ['medical', 'injury'],
    facilities: [
      'equipment_fault',
      'power_outage',
      'water_leak',
      'lift_entrapment',
      'hvac_fault',
      'network_outage',
    ],
    environment: ['severe_weather', 'flooding', 'fallen_tree'],
    traffic: ['traffic_accident', 'blocked_access'],
  };

  it.each(INCIDENT_CATEGORIES)('puts exactly the ADR-0021 types in %s', (category) => {
    const types = INCIDENT_TYPES.filter((type) => categoryOf(type) === category);

    expect([...types].sort()).toEqual([...ADR_0021[category]].sort());
  });

  it('has one entry for every incident type and nothing else', () => {
    expect(Object.keys(INCIDENT_TYPE_CATEGORY).sort()).toEqual([...INCIDENT_TYPES].sort());
  });

  it('gives every type a known category, and every category a type', () => {
    const used = new Set(INCIDENT_TYPES.map(categoryOf));

    for (const category of used) expect(INCIDENT_CATEGORIES).toContain(category);
    expect(used.size).toBe(INCIDENT_CATEGORIES.length);
  });
});

describe('INCIDENT_TYPE_DEFAULT_SEVERITY', () => {
  it('suggests the severities ADR-0021 decides', () => {
    expect(INCIDENT_TYPE_DEFAULT_SEVERITY).toEqual({
      intrusion: 'high',
      theft: 'medium',
      vandalism: 'low',
      suspicious_object: 'medium',
      suspicious_person: 'medium',
      assault: 'high',
      crowding: 'low',
      fire_alarm: 'high',
      fire: 'critical',
      gas_leak: 'critical',
      hazmat_spill: 'high',
      medical: 'high',
      injury: 'medium',
      equipment_fault: 'medium',
      power_outage: 'high',
      water_leak: 'medium',
      lift_entrapment: 'high',
      hvac_fault: 'medium',
      network_outage: 'medium',
      severe_weather: 'high',
      flooding: 'high',
      fallen_tree: 'medium',
      traffic_accident: 'high',
      blocked_access: 'low',
    });
  });

  it('gives every incident type a known severity', () => {
    expect(Object.keys(INCIDENT_TYPE_DEFAULT_SEVERITY).sort()).toEqual([...INCIDENT_TYPES].sort());
    for (const severity of Object.values(INCIDENT_TYPE_DEFAULT_SEVERITY)) {
      expect(INCIDENT_SEVERITIES).toContain(severity);
    }
  });
});

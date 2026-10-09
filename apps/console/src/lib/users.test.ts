import type { Role } from '@occ/contracts';
import { initials, rolesLabel } from './users';

describe('rolesLabel', () => {
  it.each<[Role[], string]>([
    [['operator'], 'Operator'],
    // Contract order, not the token's order.
    [['viewer', 'operator'], 'Operator · Viewer'],
    [['supervisor', 'operator', 'viewer'], 'Operator · Supervisor · Viewer'],
    [['technician', 'operator'], 'Operator · Technician'],
    [['viewer', 'technician'], 'Technician · Viewer'],
    [['operator', 'operator'], 'Operator'],
    [[], ''],
  ])('labels %j as "%s"', (roles, expected) => {
    expect(rolesLabel(roles)).toBe(expected);
  });
});

describe('initials', () => {
  it.each([
    ['Demo Operator', 'DO'],
    ['Operator', 'O'],
    // First and last word, whatever lies between.
    ['Trương Tấn Khánh', 'TK'],
    ['  demo   operator  ', 'DO'],
    // A letter outside the Basic Multilingual Plane is kept whole, not half a surrogate pair.
    ['𝒜da Lovelace', '𝒜L'],
    ['', ''],
    ['   ', ''],
  ])('turns "%s" into "%s"', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

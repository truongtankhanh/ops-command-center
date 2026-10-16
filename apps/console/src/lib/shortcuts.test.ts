import { SHORTCUTS } from './shortcuts';

const rows = SHORTCUTS.flatMap((group) => group.rows);

/*
 * Pins the console's single-character shortcuts (V2-11.5). Phase 3 (assets and telemetry in the 2D
 * console) added none: `F` and `V` come with the 3D view (V2-16), and until then the list is the one
 * the V1 console shipped. A letter added later turns this red on purpose, so the help dialog, the
 * `useShortcut` registration and the WCAG 2.1.4 switch in the account menu are decided together
 * (`.claude/rules/console.md`).
 */
describe('the keyboard shortcuts', () => {
  it('has the same single-character keys as before the assets phase', () => {
    const characterKeys = rows.filter((row) => row.character).flatMap((row) => row.keys);

    expect(characterKeys).toEqual(['N', '/', '?', 'A', 'R']);
  });

  it('gives each of them the permission it has always needed', () => {
    const permissionOf = (key: string) => rows.find((row) => row.keys.includes(key))?.permission;

    expect(permissionOf('N')).toBe('incident:report');
    expect(permissionOf('A')).toBe('incident:acknowledge');
    expect(permissionOf('R')).toBe('incident:resolve');
    expect(permissionOf('/')).toBeUndefined();
    expect(permissionOf('?')).toBeUndefined();
  });

  it('marks every letter or digit key as a character key, so none can slip past the switch', () => {
    const unmarked = rows
      .filter((row) => !row.character)
      .flatMap((row) => row.keys)
      .filter((key) => /^[A-Za-z0-9]$/.test(key));

    expect(unmarked).toEqual([]);
  });

  it('lists no 3D key yet', () => {
    const keys = rows.flatMap((row) => row.keys);

    expect(keys).not.toContain('F');
    expect(keys).not.toContain('V');
  });
});

import { SHORTCUTS } from './shortcuts';

const rows = SHORTCUTS.flatMap((group) => group.rows);
const group = (title: string) => SHORTCUTS.find((candidate) => candidate.title === title);
const rowsOf = (key: string) => rows.filter((row) => row.keys.includes(key));

/*
 * Pins the console's single-character shortcuts (V2-11.5, V2-18.1). The assets phase added none;
 * `V` and `F` come with the 3D view, and `F` is listed in three places (anywhere, the incident
 * panel, the asset inspector) because it flies to a different thing in each. A letter added later
 * turns this red on purpose, so the help dialog, the `useShortcut` registration and the WCAG 2.1.4
 * switch in the account menu are decided together (`.claude/rules/console.md`).
 */
describe('the keyboard shortcuts', () => {
  it('has these single-character keys, each listed once or more', () => {
    const characterKeys = rows.filter((row) => row.character).flatMap((row) => row.keys);

    expect([...new Set(characterKeys)]).toEqual(['N', '/', 'V', 'F', 'P', '?', 'A', 'R']);
  });

  it('gives each of them the permission it needs, and V and F none', () => {
    const permissionOf = (key: string) => rows.find((row) => row.keys.includes(key))?.permission;

    expect(permissionOf('N')).toBe('incident:report');
    expect(permissionOf('A')).toBe('incident:acknowledge');
    expect(permissionOf('R')).toBe('incident:resolve');
    for (const key of ['/', '?', 'V', 'F']) expect(permissionOf(key)).toBeUndefined();
  });

  it('marks every letter or digit key as a character key, so none can slip past the switch', () => {
    const unmarked = rows
      .filter((row) => !row.character)
      .flatMap((row) => row.keys)
      .filter((key) => /^[A-Za-z0-9]$/.test(key));

    expect(unmarked).toEqual([]);
  });

  it('lists F in the three places it acts, each a 3D-only character key', () => {
    const groupsOfF = SHORTCUTS.filter((candidate) =>
      candidate.rows.some((row) => row.keys.includes('F')),
    ).map((candidate) => candidate.title);

    expect(groupsOfF).toEqual(['Anywhere', 'Incident panel', 'Asset inspector']);
    for (const row of [...rowsOf('F'), ...rowsOf('V')]) {
      expect(row.character).toBe(true);
      expect(row.requires).toBe('twin');
    }
  });

  it("follows frame 16's order of groups, with the 2D map before the tabs", () => {
    expect(SHORTCUTS.map((candidate) => candidate.title)).toEqual([
      'Anywhere',
      '3D view, while it has focus',
      '3D view, pointer and touch',
      'Incident panel',
      'Asset inspector',
      'Incident and asset lists',
      '2D map, while it has focus',
      'Tabs',
      'Dialogs and menus',
    ]);
  });

  it('needs 3D for every row of the 3D groups and of the asset inspector', () => {
    for (const title of [
      '3D view, while it has focus',
      '3D view, pointer and touch',
      'Asset inspector',
    ]) {
      const { rows: groupRows } = group(title)!;
      expect(groupRows.length).toBeGreaterThan(0);
      for (const row of groupRows) expect(row.requires).toBe('twin');
    }
  });

  it("needs 3D for nothing in V1's groups, and marks no 3D key as a character key but V and F", () => {
    for (const title of [
      'Incident and asset lists',
      '2D map, while it has focus',
      'Tabs',
      'Dialogs and menus',
    ]) {
      for (const row of group(title)!.rows) expect(row.requires).toBeUndefined();
    }
    const characterOnly = rows
      .filter((row) => row.requires === 'twin' && row.character)
      .flatMap((row) => row.keys);
    expect(new Set(characterOnly)).toEqual(new Set(['V', 'F', 'P']));
  });

  it('draws the two pans as chords of Shift and another key', () => {
    const chords = rows.filter((row) => row.chord);

    expect(chords.map((row) => row.keys)).toEqual([
      ['Shift', 'arrows'],
      ['Shift', 'Drag'],
    ]);
    expect(chords.map((row) => row.description)).toEqual([
      'Pan',
      'Pan (Pan tool: rotate; also right-drag, two-finger drag pan)',
    ]);
  });

  it('describes Home as a reset to the campus view', () => {
    const home = group('3D view, while it has focus')!.rows.find((row) => row.keys[0] === 'Home');

    expect(home?.description).toBe('Reset to the campus view');
  });

  it('keeps a description unique within each group, since the help keys its rows by it', () => {
    for (const { title, rows: groupRows } of SHORTCUTS) {
      const descriptions = groupRows.map((row) => row.description);
      expect({ title, unique: new Set(descriptions).size }).toEqual({
        title,
        unique: descriptions.length,
      });
    }
  });
});

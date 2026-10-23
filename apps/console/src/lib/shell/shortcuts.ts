import type { Permission } from '@occ/contracts';

/**
 * The console's keyboard shortcuts: whether the single-key ones are on, and the list the help
 * dialog shows.
 *
 * WCAG 2.1.4 (Character Key Shortcuts): a shortcut made of one character key must be possible to
 * turn off, because speech input can type it by accident. They are on by default and the switch in
 * the account menu turns them all off; `useShortcut` checks it. Keys that only act while focus is
 * on their widget (arrows in the list, Escape in a panel) are not character keys and stay on.
 */

const STORAGE_KEY = 'occ.console.keyboardShortcuts';

/**
 * Whether single-key shortcuts are on in this browser. Only "off" is stored, so the default is on
 * and cleared or unavailable storage gives it back.
 */
export function readKeyboardShortcuts(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeKeyboardShortcuts(on: boolean): void {
  try {
    if (on) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'false');
  } catch {
    // Not remembered: the choice still holds until the page reloads.
  }
}

export interface ShortcutRow {
  /** The keys as printed, one `Kbd` each; alternatives such as "↑" / "↓". */
  keys: readonly string[];
  description: string;
  /** A single character key, turned off with the others (WCAG 2.1.4). */
  character?: boolean;
  /**
   * Shown only to a user whose roles grant this; the key does nothing for anyone else. Acknowledge
   * and resolve are also limited by incident category: the help then adds the user's categories to
   * the description (ADR-0021), so nothing is marked here.
   */
  permission?: Permission;
  /**
   * Shown only while the 3D view can be drawn (`twinCapability`, ADR-0020): the key does nothing in
   * the 2D view or where 3D is unavailable, so the help does not list it there (V2-18.1). The help
   * reads this; each handler checks availability itself (V2-18.2, V2-18.3).
   */
  requires?: 'twin';
  /**
   * The keys are pressed together and drawn joined with "+", as frame 16 draws "Shift + arrows".
   * Without it, `keys` are alternatives drawn side by side.
   */
  chord?: boolean;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

/**
 * What the help dialog lists. It documents the keys; each component still handles its own
 * (`useShortcut`, `Sheet`, `Dialog`, `Tabs`, the feed's rows, MapLibre's canvas), so a key added
 * there is added here too. The groups and their order are frame 16's; its "New" tags are review
 * annotations and are not shipped (V2-12.1). `V` and `F` are character keys, so they go with the
 * others when single-key shortcuts are off; the 3D view's own keys act only while the stage has
 * focus and stay.
 */
export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Anywhere',
    rows: [
      {
        keys: ['N'],
        description: 'Report an incident',
        character: true,
        permission: 'incident:report',
      },
      { keys: ['/'], description: 'Search incidents or assets', character: true },
      {
        keys: ['V'],
        description: 'Switch between 3D and 2D',
        character: true,
        requires: 'twin',
      },
      { keys: ['F'], description: 'Fly to the selection', character: true, requires: 'twin' },
      {
        keys: ['P'],
        description: 'Switch the drag between Orbit and Pan',
        character: true,
        requires: 'twin',
      },
      { keys: ['?'], description: 'Show keyboard shortcuts', character: true },
    ],
  },
  {
    title: '3D view, while it has focus',
    rows: [
      { keys: ['←', '→'], description: 'Orbit around the target', requires: 'twin' },
      { keys: ['↑', '↓'], description: 'Tilt (20°–78°)', requires: 'twin' },
      { keys: ['Shift', 'arrows'], description: 'Pan', chord: true, requires: 'twin' },
      { keys: ['+', '−'], description: 'Zoom in or out', requires: 'twin' },
      { keys: ['Home'], description: 'Reset to the campus view', requires: 'twin' },
      {
        keys: ['Esc'],
        description: 'Up one level: part → asset → building → campus',
        requires: 'twin',
      },
    ],
  },
  {
    title: '3D view, pointer and touch',
    rows: [
      { keys: ['Drag'], description: 'Rotate (Pan tool: move the view)', requires: 'twin' },
      {
        keys: ['Shift', 'Drag'],
        description: 'Pan (Pan tool: rotate; also right-drag, two-finger drag pan)',
        chord: true,
        requires: 'twin',
      },
      { keys: ['Wheel'], description: 'Zoom toward the pointer (also pinch)', requires: 'twin' },
      { keys: ['Click'], description: 'Select a building, asset or part', requires: 'twin' },
    ],
  },
  {
    title: 'Incident panel',
    rows: [
      {
        keys: ['A'],
        description: 'Acknowledge',
        character: true,
        permission: 'incident:acknowledge',
      },
      { keys: ['R'], description: 'Resolve', character: true, permission: 'incident:resolve' },
      {
        keys: ['F'],
        description: "Show the incident's asset in 3D",
        character: true,
        requires: 'twin',
      },
      { keys: ['Esc'], description: 'Close the panel (kept open while a draft is written)' },
    ],
  },
  {
    // Both rows need 3D: the callout exists only there, and the sheet's own Escape in 2D is
    // already listed under "Incident panel" and "Dialogs and menus".
    title: 'Asset inspector',
    rows: [
      {
        keys: ['F'],
        description: 'Fly to the asset or the selected part',
        character: true,
        requires: 'twin',
      },
      {
        keys: ['Esc'],
        description: 'Close the part callout, then the inspector',
        requires: 'twin',
      },
    ],
  },
  {
    title: 'Incident and asset lists',
    rows: [
      { keys: ['↑', '↓'], description: 'Previous or next incident or asset' },
      { keys: ['Home', 'End'], description: 'First or last incident or asset' },
    ],
  },
  {
    title: '2D map, while it has focus',
    rows: [
      { keys: ['←', '↑', '→', '↓'], description: 'Move the map' },
      { keys: ['+', '-'], description: 'Zoom in or out' },
    ],
  },
  {
    title: 'Tabs',
    rows: [
      { keys: ['←', '→'], description: 'Previous or next tab' },
      { keys: ['Home', 'End'], description: 'First or last tab' },
    ],
  },
  {
    title: 'Dialogs and menus',
    rows: [
      { keys: ['Tab', 'Shift+Tab'], description: 'Next or previous control' },
      { keys: ['Esc'], description: 'Close' },
    ],
  },
];

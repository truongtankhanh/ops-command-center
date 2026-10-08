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
  /** Shown only to a user whose roles grant this; the key does nothing for anyone else. */
  permission?: Permission;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

/**
 * What the help dialog lists. It documents the keys; each component still handles its own
 * (`useShortcut`, `Sheet`, `Dialog`, `Tabs`, the feed's rows, MapLibre's canvas), so a key added
 * there is added here too.
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
      { keys: ['/'], description: 'Search incidents', character: true },
      { keys: ['?'], description: 'Show keyboard shortcuts', character: true },
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
      { keys: ['Esc'], description: 'Close the panel (kept open while a draft is written)' },
    ],
  },
  {
    title: 'Incident list',
    rows: [
      { keys: ['↑', '↓'], description: 'Previous or next incident' },
      { keys: ['Home', 'End'], description: 'First or last incident' },
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
    title: 'Map, while it has focus',
    rows: [
      { keys: ['←', '↑', '→', '↓'], description: 'Move the map' },
      { keys: ['+', '-'], description: 'Zoom in or out' },
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

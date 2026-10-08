import { FRESH_LIMIT, useConsole } from './store';
import { resetStore } from './test-utils';

const state = () => useConsole.getState();

describe('useConsole', () => {
  beforeEach(() => resetStore(useConsole));

  // The detail sends `noteDrafts[incident.id]` with Acknowledge / Resolve: a note kept under the
  // wrong incident would land on another incident's timeline (UI-10 D7).
  describe('note drafts', () => {
    it('keeps a note for its incident', () => {
      state().setNote('a', 'Guard on the way');

      expect(state().noteDrafts).toEqual({ a: 'Guard on the way' });
    });

    it('keeps notes per incident, and changes only the one written to', () => {
      state().setNote('a', 'A');
      state().setNote('b', 'B');
      state().setNote('a', 'A2');

      expect(state().noteDrafts).toEqual({ a: 'A2', b: 'B' });
    });

    it('stores the note as typed, leading spaces included', () => {
      state().setNote('a', '  leading space');

      expect(state().noteDrafts.a).toBe('  leading space');
    });

    it('removes only that incident when its note is emptied', () => {
      state().setNote('a', 'A');
      state().setNote('b', 'B');

      state().setNote('a', '');

      expect(state().noteDrafts).not.toHaveProperty('a');
      expect(state().noteDrafts).toEqual({ b: 'B' });
    });

    it('clears only the given incident', () => {
      state().setNote('a', 'A');
      state().setNote('b', 'B');

      state().clearNote('a');

      expect(state().noteDrafts).toEqual({ b: 'B' });
    });

    it('leaves the notes as they were when the incident has none', () => {
      state().setNote('a', 'A');

      state().clearNote('missing');

      expect(state().noteDrafts).toEqual({ a: 'A' });
    });

    it('keeps every note while the operator moves between incidents and the report form', () => {
      state().setNote('a', 'A');
      state().setNote('b', 'B');
      const drafts = { a: 'A', b: 'B' };

      state().select('b');
      expect(state().noteDrafts).toEqual(drafts);
      state().startReport();
      expect(state().noteDrafts).toEqual(drafts);
      state().select(null);
      expect(state().noteDrafts).toEqual(drafts);
      state().closeReport();
      expect(state().noteDrafts).toEqual(drafts);
    });
  });

  describe('selection and the report form', () => {
    it('selects an incident and closes the report form', () => {
      state().startReport();

      state().select('a');

      expect(state().selectedIncidentId).toBe('a');
      expect(state().reporting).toBe(false);
    });

    it('stops treating a selected incident as fresh, and only that one', () => {
      state().markFresh('a');
      state().markFresh('b');

      state().select('a');

      expect([...state().fresh]).toEqual(['b']);
    });

    it('leaves the fresh incidents alone when nothing fresh is selected', () => {
      state().markFresh('b');

      state().select('c');
      expect([...state().fresh]).toEqual(['b']);

      state().select(null);
      expect([...state().fresh]).toEqual(['b']);
    });

    it('opens the report form without a selection, and closes it', () => {
      state().select('a');

      state().startReport();
      expect(state().reporting).toBe(true);
      expect(state().selectedIncidentId).toBeNull();

      state().closeReport();
      expect(state().reporting).toBe(false);
    });
  });

  describe('severity filter', () => {
    it('filters by a severity and shows the active tab, which the KPI tiles count', () => {
      state().setFilter('resolved');

      state().toggleSeverity('high');

      expect(state().severity).toBe('high');
      expect(state().filter).toBe('active');
    });

    it('clears the severity on a second press, staying on the active tab', () => {
      state().toggleSeverity('high');

      state().toggleSeverity('high');

      expect(state().severity).toBeNull();
      expect(state().filter).toBe('active');
    });

    it('switches to another severity instead of clearing', () => {
      state().toggleSeverity('high');

      state().toggleSeverity('low');

      expect(state().severity).toBe('low');
    });

    it('clears the severity', () => {
      state().toggleSeverity('critical');

      state().clearSeverity();

      expect(state().severity).toBeNull();
    });
  });

  describe('live state', () => {
    it('marks an incident fresh in a new set, leaving the old one as it was', () => {
      const before = state().fresh;

      state().markFresh('a');

      expect(state().fresh).not.toBe(before);
      expect(state().fresh.has('a')).toBe(true);
      expect(before.has('a')).toBe(false);
    });

    // A fresh row stays highlighted until it is looked at, so the set must not grow over a shift.
    it('keeps only the newest incidents fresh', () => {
      for (let i = 0; i <= FRESH_LIMIT; i++) state().markFresh(`id-${i}`);

      expect(state().fresh.size).toBe(FRESH_LIMIT);
      expect(state().fresh.has('id-0')).toBe(false);
      expect(state().fresh.has(`id-${FRESH_LIMIT}`)).toBe(true);

      state().markFresh('id-5');

      expect(state().fresh.size).toBe(FRESH_LIMIT);
    });

    it('forgets one fresh incident in a new set', () => {
      state().markFresh('a');
      state().markFresh('b');
      const before = state().fresh;

      state().forgetFresh('a');

      expect([...state().fresh]).toEqual(['b']);
      expect(before.has('a')).toBe(true);
    });

    it('leaves the set as it was when the incident is not fresh', () => {
      state().markFresh('a');
      const before = state().fresh;

      state().forgetFresh('b');

      expect(state().fresh).toBe(before);
    });

    it('records the last sign of life, now when no time is given', () => {
      state().markAlive(1_000);
      expect(state().lastEventAt).toBe(1_000);

      const now = vi.spyOn(Date, 'now').mockReturnValue(2_000);
      try {
        state().markAlive();
        expect(state().lastEventAt).toBe(2_000);
      } finally {
        now.mockRestore();
      }
    });
  });

  // The offline banner, the pill and the feed say since when the data may be stale (UI-15).
  describe('offline time', () => {
    it('starts unset', () => {
      expect(state().offlineSince).toBeNull();
    });

    it('keeps the time the link was lost through every reconnect attempt, until it is live', () => {
      state().setConnection('live', 500);
      state().setConnection('offline', 1_000);
      expect(state().offlineSince).toBe(1_000);

      state().setConnection('reconnecting', 2_000);
      expect(state().offlineSince).toBe(1_000);

      state().setConnection('live', 3_000);
      expect(state().offlineSince).toBeNull();
    });

    it('starts the clock on a reconnect attempt too', () => {
      state().setConnection('live', 500);
      state().setConnection('reconnecting', 5_000);

      expect(state().offlineSince).toBe(5_000);
    });

    it('leaves it as it was while connecting', () => {
      state().setConnection('connecting', 1_000);
      expect(state().offlineSince).toBeNull();

      state().setConnection('offline', 2_000);
      state().setConnection('connecting', 3_000);
      expect(state().offlineSince).toBe(2_000);
    });

    it('uses the current time when none is given', () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(4_000);
      try {
        state().setConnection('offline');
        expect(state().offlineSince).toBe(4_000);
      } finally {
        now.mockRestore();
      }
    });
  });

  // The form and the map share the report's location; a cancelled pin must never come back.
  describe('report location', () => {
    const PIN: [number, number] = [108.4415, 11.953];

    it('chooses a zone, and drops the pin when the zone changes', () => {
      state().startReport();
      state().placePin(PIN, 'z1');
      const before = state();

      state().setReportZone('z1');
      expect(state()).toBe(before);

      state().setReportZone('z2');
      expect(state()).toMatchObject({ reportZoneId: 'z2', reportPosition: null, pinMissed: false });
    });

    it('places, misses and clears the pin', () => {
      state().placePin(PIN, 'z1');
      expect(state()).toMatchObject({ reportPosition: PIN, reportZoneId: 'z1', pinMissed: false });

      state().missPin();
      expect(state()).toMatchObject({ reportPosition: PIN, pinMissed: true });

      state().placePin(PIN, 'z1');
      expect(state().pinMissed).toBe(false);

      state().clearPin();
      expect(state()).toMatchObject({ reportPosition: null, reportZoneId: 'z1', pinMissed: false });
    });

    it('forgets a miss when picking stops, not when it starts', () => {
      state().missPin();

      state().setPicking(true);
      expect(state()).toMatchObject({ picking: true, pinMissed: true });

      state().setPicking(false);
      expect(state()).toMatchObject({ picking: false, pinMissed: false });
    });

    it.each([
      ['startReport', () => state().startReport()],
      ['closeReport', () => state().closeReport()],
      ['select an incident', () => state().select('a')],
      ['select nothing', () => state().select(null)],
    ])('resets the location on %s', (_name, act) => {
      state().setReportZone('z1');
      state().placePin(PIN, 'z1');
      state().setPicking(true);
      state().missPin();

      act();

      expect(state()).toMatchObject({
        reportZoneId: null,
        reportPosition: null,
        picking: false,
        pinMissed: false,
      });
    });
  });

  // The viewer is a modal over the console: opening it must leave the sheet under it as it was,
  // and the sheet moving on must not close it (UI-13 D10).
  describe('camera viewer', () => {
    it('opens a camera and closes', () => {
      state().openViewer('c1');
      expect(state().viewerCameraId).toBe('c1');

      state().closeViewer();
      expect(state().viewerCameraId).toBeNull();
    });

    it.each([
      ['select an incident', () => state().select('a')],
      ['startReport', () => state().startReport()],
      ['closeReport', () => state().closeReport()],
    ])('keeps the viewer open on %s', (_name, act) => {
      state().openViewer('c1');

      act();

      expect(state().viewerCameraId).toBe('c1');
    });
  });

  describe('critical sound', () => {
    const stored = () => localStorage.getItem('occ.console.criticalSound');

    beforeEach(() => localStorage.clear());

    it('is off by default', () => {
      expect(useConsole.getInitialState().criticalSound).toBe(false);
    });

    it('turns on and remembers it in this browser', () => {
      state().setCriticalSound(true);

      expect(state().criticalSound).toBe(true);
      expect(stored()).toBe('true');
    });

    it('turns off and forgets it', () => {
      state().setCriticalSound(true);
      state().setCriticalSound(false);

      expect(state().criticalSound).toBe(false);
      expect(stored()).toBeNull();
    });
  });

  describe('camera pins', () => {
    const KNOWN = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const stored = () => JSON.parse(localStorage.getItem('occ.console.pinnedCameras') ?? 'null');

    beforeEach(() => localStorage.clear());

    it('pins a camera and remembers it in this browser', () => {
      state().toggleCameraPin('c1', KNOWN);

      expect(state().pinnedCameraIds).toEqual(['c1']);
      expect(stored()).toEqual(['c1']);
    });

    it('unpins it again, and remembers that too', () => {
      state().toggleCameraPin('c1', KNOWN);
      state().toggleCameraPin('c1', KNOWN);

      expect(state().pinnedCameraIds).toEqual([]);
      expect(stored()).toEqual([]);
    });

    it('pins no fifth camera', () => {
      for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) state().toggleCameraPin(id, KNOWN);

      expect(state().pinnedCameraIds).toEqual(['c1', 'c2', 'c3', 'c4']);
    });

    it('drops the pin of a camera that is gone', () => {
      useConsole.setState({ pinnedCameraIds: ['gone'] });

      state().toggleCameraPin('c1', KNOWN);

      expect(state().pinnedCameraIds).toEqual(['c1']);
    });
  });
});

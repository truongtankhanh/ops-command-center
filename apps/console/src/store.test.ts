import { useConsole } from './store';
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
});

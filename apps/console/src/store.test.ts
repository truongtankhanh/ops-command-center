import type { ReportPreset } from './lib/assets/assetReport';
import { levelOf } from './lib/twin-core/twinLevel';
import { FRESH_LIMIT, useConsole } from './store';
import { resetStore, stubTwinAvailable, unstubTwin } from './test-utils';

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

  describe('side panel', () => {
    it('starts on the incidents', () => {
      expect(state().sidePanel).toBe('incidents');
    });

    it('switches panel', () => {
      state().setSidePanel('assets');
      expect(state().sidePanel).toBe('assets');

      state().setSidePanel('incidents');
      expect(state().sidePanel).toBe('incidents');
    });

    it('keeps the incident selection and the severity chip while the assets are shown', () => {
      state().select('a');
      state().toggleSeverity('high');

      state().setSidePanel('assets');

      expect(state().selectedIncidentId).toBe('a');
      expect(state().severity).toBe('high');
    });
  });

  // The incident detail, the report form and (V2-09.8) the asset inspector share one sheet.
  describe('asset selection', () => {
    it('starts with no asset selected or hovered', () => {
      expect(state().selectedAssetCode).toBeNull();
      expect(state().hoveredAssetCode).toBeNull();
    });

    it('selects an asset and closes the incident, the report form and the pin', () => {
      state().select('a');
      state().startReport();
      state().setReportZone('z1');
      state().setPicking(true);

      state().selectAsset('CT-01', null);

      expect(state().selectedAssetCode).toBe('CT-01');
      expect(state().selectedIncidentId).toBeNull();
      expect(state().reporting).toBe(false);
      expect(state().reportZoneId).toBeNull();
      expect(state().picking).toBe(false);
    });

    it('closes the selected asset when an incident is selected', () => {
      state().selectAsset('CT-01', null);

      state().select('a');

      expect(state().selectedAssetCode).toBeNull();
      expect(state().selectedIncidentId).toBe('a');
    });

    it('closes the selected asset when the report form opens', () => {
      state().selectAsset('CT-01', null);

      state().startReport();

      expect(state().selectedAssetCode).toBeNull();
      expect(state().reporting).toBe(true);
    });

    it('keeps the asset when the incident sheet or the report form is closed', () => {
      state().selectAsset('CT-01', null);

      state().select(null);
      state().closeReport();

      expect(state().selectedAssetCode).toBe('CT-01');
    });

    it('clears the asset without reopening anything', () => {
      state().selectAsset('CT-01', null);

      state().selectAsset(null);

      expect(state().selectedAssetCode).toBeNull();
      expect(state().selectedIncidentId).toBeNull();
      expect(state().reporting).toBe(false);
    });

    it('hovers and un-hovers an asset without selecting it', () => {
      state().hoverAsset('CT-02');
      expect(state().hoveredAssetCode).toBe('CT-02');
      expect(state().selectedAssetCode).toBeNull();

      state().hoverAsset(null);
      expect(state().hoveredAssetCode).toBeNull();
    });
  });

  describe('asset filters', () => {
    it('starts on every asset in every zone', () => {
      expect(state().assetFilter).toBe('all');
      expect(state().assetZoneId).toBeNull();
    });

    it('sets the filter tab and the zone, and clears the zone', () => {
      state().setAssetFilter('faults');
      state().setAssetZone('z1');

      expect(state().assetFilter).toBe('faults');
      expect(state().assetZoneId).toBe('z1');

      state().setAssetZone(null);
      expect(state().assetZoneId).toBeNull();
    });
  });

  // V2-15.2: the 3D view's four levels. The level is derived (`levelOf`), never stored; these are the
  // transitions of ADR-0020 "Settled in V2-15.1".
  describe('scene levels', () => {
    const level = () => levelOf(state());

    it('starts on the campus, with no building, part or hovered part', () => {
      expect(state().focusZoneId).toBeNull();
      expect(state().selectedPart).toBeNull();
      expect(state().hoveredPart).toBeNull();
      expect(level()).toBe('campus');
    });

    describe('selecting an asset', () => {
      it('focuses the building it is in, and leaves the Assets filter alone', () => {
        state().selectAsset('GEN-01', 'BLD-DC');

        expect(state().focusZoneId).toBe('BLD-DC');
        expect(state().assetZoneId).toBeNull();
        expect(level()).toBe('asset');
      });

      it('ends the focus for an asset outside every building', () => {
        state().focusBuilding('BLD-DC');

        state().selectAsset('TR-01', null);

        expect(state().focusZoneId).toBeNull();
        expect(state().selectedAssetCode).toBe('TR-01');
      });

      it('moves the focus to the other building', () => {
        state().selectAsset('CT-01', 'BLD-DC');

        state().selectAsset('AHU-L1', 'BLD-LIB');

        expect(state().focusZoneId).toBe('BLD-LIB');
      });

      it('keeps the focus for another asset of the same building', () => {
        state().selectAsset('CT-01', 'BLD-DC');

        state().selectAsset('CT-02', 'BLD-DC');

        expect(state().focusZoneId).toBe('BLD-DC');
      });

      it('clears the selected part and the hovered part', () => {
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');
        state().hoverPart('FanMotor');

        state().selectAsset('CT-02', 'BLD-DC');

        expect(state().selectedPart).toBeNull();
        expect(state().hoveredPart).toBeNull();
      });

      it('keeps the building in focus when the asset is cleared, and clears its part', () => {
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');

        state().selectAsset(null);

        expect(state().selectedAssetCode).toBeNull();
        expect(state().selectedPart).toBeNull();
        expect(state().focusZoneId).toBe('BLD-DC');
        expect(level()).toBe('building');
      });
    });

    describe('the part', () => {
      it('is selected and cleared while an asset is selected', () => {
        state().selectAsset('CT-01', 'BLD-DC');

        state().selectPart('FanBlade');
        expect(state().selectedPart).toBe('FanBlade');
        expect(level()).toBe('part');

        state().selectPart(null);
        expect(state().selectedPart).toBeNull();
        expect(level()).toBe('asset');
      });

      it('cannot be selected without an asset', () => {
        const before = state();

        state().selectPart('FanBlade');

        expect(state()).toBe(before);
        expect(state().selectedPart).toBeNull();
      });

      it('is cleared when an incident is selected or a report starts', () => {
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');
        state().select('a');
        expect(state().selectedPart).toBeNull();

        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');
        state().startReport();
        expect(state().selectedPart).toBeNull();
      });

      it('survives closing the incident sheet, which keeps the asset', () => {
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');

        state().select(null);

        expect(state().selectedPart).toBe('FanBlade');
      });

      it('is hovered and un-hovered without being selected', () => {
        state().hoverPart('FanBlade');
        expect(state().hoveredPart).toBe('FanBlade');
        expect(state().selectedPart).toBeNull();

        state().hoverPart(null);
        expect(state().hoveredPart).toBeNull();
      });

      it('changes nothing when the same part is hovered again', () => {
        state().hoverPart('FanBlade');
        const before = state();

        state().hoverPart('FanBlade');

        expect(state()).toBe(before);
      });
    });

    describe('focusing a building', () => {
      it('sets the focus and the Assets filter to the building', () => {
        state().focusBuilding('BLD-DC');

        expect(state().focusZoneId).toBe('BLD-DC');
        expect(state().assetZoneId).toBe('BLD-DC');
        expect(level()).toBe('building');
      });

      it('is the building level: the selected asset and part are cleared', () => {
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');

        state().focusBuilding('BLD-LIB');

        expect(state().selectedAssetCode).toBeNull();
        expect(state().selectedPart).toBeNull();
        expect(state().focusZoneId).toBe('BLD-LIB');
      });

      it('replaces a filter the operator had, because the click is explicit', () => {
        state().setAssetZone('BLD-LIB');

        state().focusBuilding('BLD-DC');

        expect(state().assetZoneId).toBe('BLD-DC');
      });

      it('changes nothing when the building is already the whole state', () => {
        state().focusBuilding('BLD-DC');
        const before = state();

        state().focusBuilding('BLD-DC');

        expect(state()).toBe(before);
      });

      it('is going to the campus when given null', () => {
        state().focusBuilding('BLD-DC');
        state().selectAsset('CT-01', 'BLD-DC');

        state().focusBuilding(null);

        expect(level()).toBe('campus');
        expect(state().focusZoneId).toBeNull();
        expect(state().selectedAssetCode).toBeNull();
      });
    });

    describe('going up', () => {
      it('goes part, asset, building, campus, one step at a time', () => {
        state().focusBuilding('BLD-DC');
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');
        const seen = [level()];

        for (let step = 0; step < 3; step++) {
          state().goUp();
          seen.push(level());
        }

        expect(seen).toEqual(['part', 'asset', 'building', 'campus']);
        expect(state().focusZoneId).toBeNull();
      });

      it('goes from an asset outside every building straight to the campus', () => {
        state().selectAsset('TR-01', null);

        state().goUp();

        expect(level()).toBe('campus');
      });

      it('does nothing at the campus', () => {
        const before = state();

        state().goUp();

        expect(state()).toBe(before);
      });

      it('clears the hovered part with the part', () => {
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');
        state().hoverPart('FanMotor');

        state().goUp();

        expect(state().hoveredPart).toBeNull();
      });
    });

    describe('going to the campus', () => {
      it('clears the part, the asset and the building', () => {
        state().selectAsset('CT-01', 'BLD-DC');
        state().selectPart('FanBlade');

        state().goCampus();

        expect(level()).toBe('campus');
        expect(state().selectedPart).toBeNull();
        expect(state().selectedAssetCode).toBeNull();
        expect(state().focusZoneId).toBeNull();
      });

      it('keeps an open incident and an open report form', () => {
        state().focusBuilding('BLD-DC');
        state().select('a');
        state().goCampus();
        expect(state().selectedIncidentId).toBe('a');

        state().startReport();
        state().focusBuilding('BLD-DC');
        state().goCampus();
        expect(state().reporting).toBe(true);
      });

      it('changes nothing at the campus', () => {
        const before = state();

        state().goCampus();

        expect(state()).toBe(before);
      });
    });
  });

  // V2-15.4: the click on an asset, shared by the 2D map and the 3D view.
  describe('toggling an asset', () => {
    it('selects an asset that is not selected and focuses its building', () => {
      state().toggleAsset('CT-01', 'BLD-DC');

      expect(state().selectedAssetCode).toBe('CT-01');
      expect(state().focusZoneId).toBe('BLD-DC');
    });

    it('moves the selection to another asset', () => {
      state().toggleAsset('CT-01', 'BLD-DC');

      state().toggleAsset('CT-02', 'BLD-DC');

      expect(state().selectedAssetCode).toBe('CT-02');
    });

    it('deselects the selected asset on a second call, keeps its building in focus and opens nothing', () => {
      state().toggleAsset('CT-01', 'BLD-DC');

      state().toggleAsset('CT-01', 'BLD-DC');

      expect(state().selectedAssetCode).toBeNull();
      expect(state().focusZoneId).toBe('BLD-DC');
      expect(state().selectedIncidentId).toBeNull();
      expect(state().reporting).toBe(false);
    });

    it('clears the selected part with the asset', () => {
      state().toggleAsset('CT-01', 'BLD-DC');
      state().selectPart('FanBlade');

      state().toggleAsset('CT-01', 'BLD-DC');

      expect(state().selectedPart).toBeNull();
    });

    it('ends the focus for an asset outside every building', () => {
      state().focusBuilding('BLD-DC');

      state().toggleAsset('TR-01', null);

      expect(state().selectedAssetCode).toBe('TR-01');
      expect(state().focusZoneId).toBeNull();
    });
  });

  // The focus writes the Assets filter only for a building click, and takes back only what it wrote.
  describe('building focus and the Assets filter', () => {
    it('is cleared on leaving the building by going up', () => {
      state().focusBuilding('BLD-DC');

      state().goUp();

      expect(state().assetZoneId).toBeNull();
      expect(state().focusFilterZoneId).toBeNull();
    });

    it('is cleared on going to the campus from an asset', () => {
      state().focusBuilding('BLD-DC');
      state().selectAsset('CT-01', 'BLD-DC');

      state().goCampus();

      expect(state().assetZoneId).toBeNull();
    });

    it('is kept when the operator chose another zone after the focus', () => {
      state().focusBuilding('BLD-DC');
      state().setAssetZone('BLD-LIB');

      state().goUp();

      expect(state().assetZoneId).toBe('BLD-LIB');
    });

    it('is kept cleared when the operator cleared it', () => {
      state().focusBuilding('BLD-DC');
      state().setAssetZone(null);

      state().goUp();

      expect(state().assetZoneId).toBeNull();
    });

    it('is kept when the operator chose the same zone before the focus came from an asset', () => {
      state().setAssetZone('BLD-DC');
      state().selectAsset('GEN-01', 'BLD-DC');

      state().goUp();
      state().goUp();

      expect(state().focusZoneId).toBeNull();
      expect(state().assetZoneId).toBe('BLD-DC');
    });

    it('is kept when the operator chose the zone and then clicked its building', () => {
      state().setAssetZone('BLD-DC');
      state().focusBuilding('BLD-DC');

      state().goCampus();

      expect(state().assetZoneId).toBe('BLD-DC');
    });

    it('drops the focus as its owner as soon as the operator sets a zone', () => {
      state().focusBuilding('BLD-DC');

      state().setAssetZone('BLD-DC');

      expect(state().focusFilterZoneId).toBeNull();
    });

    it('is taken back from the old building and not set for the new one by selecting an asset', () => {
      state().focusBuilding('BLD-DC');

      state().selectAsset('AHU-L1', 'BLD-LIB');

      expect(state().focusZoneId).toBe('BLD-LIB');
      expect(state().assetZoneId).toBeNull();
    });
  });

  describe('category filter', () => {
    it('starts with every category', () => {
      expect(state().category).toBeNull();
    });

    it('chooses one category, and null clears it', () => {
      state().setCategory('security');
      expect(state().category).toBe('security');

      state().setCategory('traffic');
      expect(state().category).toBe('traffic');

      state().setCategory(null);
      expect(state().category).toBeNull();
    });

    // Unlike a severity tile, the popover is not a shortcut to the active tab or to the incidents panel.
    it('leaves the tab, the severity and the side panel as they were', () => {
      state().toggleSeverity('high');
      state().setFilter('all');
      state().setSidePanel('assets');

      state().setCategory('medical');

      expect(state().filter).toBe('all');
      expect(state().severity).toBe('high');
      expect(state().sidePanel).toBe('assets');
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

    // The tiles filter the incident feed: with the assets showing, a press must show the feed.
    it('shows the incidents panel when a severity is selected, and not when it is cleared', () => {
      state().setSidePanel('assets');

      state().toggleSeverity('high');
      expect(state().sidePanel).toBe('incidents');

      state().setSidePanel('assets');
      state().toggleSeverity('high');
      expect(state().severity).toBeNull();
      expect(state().sidePanel).toBe('assets');
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
  describe('report preset', () => {
    const PIN: [number, number] = [108.4415, 11.953];
    const PRESET: ReportPreset = {
      zoneId: 'z1',
      position: PIN,
      category: 'facilities',
      type: 'equipment_fault',
      title: 'Fault — Cooling tower 1 (CT-01)',
    };

    it('starts a report with the preset, its zone and its pin', () => {
      state().startReport(PRESET);

      expect(state()).toMatchObject({
        reporting: true,
        reportZoneId: 'z1',
        reportPosition: PIN,
        reportPreset: PRESET,
        picking: false,
        pinMissed: false,
      });
    });

    it('starts without a pin when the preset has none', () => {
      state().startReport({ ...PRESET, position: null });

      expect(state()).toMatchObject({ reportZoneId: 'z1', reportPosition: null });
    });

    it('closes the selected asset and the selected incident, as any report does', () => {
      state().select('a');
      state().selectAsset('CT-01', null);

      state().startReport(PRESET);

      expect(state()).toMatchObject({ selectedIncidentId: null, selectedAssetCode: null });
    });

    it('starts an empty report when none is given, whatever the last one began with', () => {
      state().startReport(PRESET);

      state().startReport();

      expect(state()).toMatchObject({
        reporting: true,
        reportZoneId: null,
        reportPosition: null,
        reportPreset: null,
      });
    });

    it.each([
      ['the report is closed', () => state().closeReport()],
      ['an incident is selected', () => state().select('a')],
      ['an asset is selected', () => state().selectAsset('CT-01', null)],
    ])('forgets the preset when %s', (_when, run) => {
      state().startReport(PRESET);

      run();

      expect(state()).toMatchObject({
        reportZoneId: null,
        reportPosition: null,
        reportPreset: null,
      });
    });

    it('keeps the preset as the baseline while the zone or the pin are changed', () => {
      state().startReport(PRESET);

      state().setReportZone('z2');
      state().placePin([108.45, 11.96], 'z2');
      state().clearPin();

      expect(state().reportPreset).toBe(PRESET);
      expect(state().reportZoneId).toBe('z2');
    });
  });

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

  // WCAG 2.1.4: single-key shortcuts can be turned off, for speech input (UI-16).
  describe('keyboard shortcuts', () => {
    const stored = () => localStorage.getItem('occ.console.keyboardShortcuts');

    beforeEach(() => localStorage.clear());

    it('are on by default', () => {
      expect(useConsole.getInitialState().keyboardShortcuts).toBe(true);
    });

    it('turn off and remember it in this browser', () => {
      state().setKeyboardShortcuts(false);

      expect(state().keyboardShortcuts).toBe(false);
      expect(stored()).toBe('false');
    });

    it('turn back on and forget it', () => {
      state().setKeyboardShortcuts(false);
      state().setKeyboardShortcuts(true);

      expect(state().keyboardShortcuts).toBe(true);
      expect(stored()).toBeNull();
    });

    it('open and close their help', () => {
      expect(state().shortcutHelpOpen).toBe(false);

      state().openShortcutHelp();
      expect(state().shortcutHelpOpen).toBe(true);

      state().closeShortcutHelp();
      expect(state().shortcutHelpOpen).toBe(false);
    });
  });

  describe('density', () => {
    const stored = () => localStorage.getItem('occ.console.density');

    beforeEach(() => localStorage.clear());

    it('is comfortable by default', () => {
      expect(useConsole.getInitialState().density).toBe('comfortable');
    });

    it('turns compact and remembers it in this browser', () => {
      state().setDensity('compact');

      expect(state().density).toBe('compact');
      expect(stored()).toBe('compact');
    });

    it('turns back to comfortable and forgets it', () => {
      state().setDensity('compact');
      state().setDensity('comfortable');

      expect(state().density).toBe('comfortable');
      expect(stored()).toBeNull();
    });
  });

  describe('view', () => {
    const KEY = 'occ.console.view';

    beforeEach(() => localStorage.clear());

    // jsdom has no WebGL 2, so every view in effect is 2D here.
    it('is 2D by default', () => {
      expect(useConsole.getInitialState().view).toBe('2d');
    });

    it('reads a stored 3D as 2D and leaves it stored for a build that can draw it', async () => {
      localStorage.setItem(KEY, '3d');
      vi.resetModules();

      const { useConsole: fresh } = await import('./store');

      expect(fresh.getState().view).toBe('2d');
      expect(localStorage.getItem(KEY)).toBe('3d');
    });

    it('does nothing for 3D while the twin cannot be drawn, and remembers nothing', () => {
      state().setView('3d');

      expect(state().view).toBe('2d');
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('remembers an explicit choice of 2D in this browser', () => {
      state().setView('2d');

      expect(state().view).toBe('2d');
      expect(localStorage.getItem(KEY)).toBe('2d');
    });

    // The twin is offered (WebGL 2 stubbed).
    describe('where the twin can be drawn', () => {
      beforeEach(() => {
        stubTwinAvailable();
      });

      afterEach(() => {
        vi.restoreAllMocks();
        unstubTwin();
      });

      it('starts in 3D when no choice was made', async () => {
        vi.resetModules();

        const { useConsole: fresh } = await import('./store');

        expect(fresh.getState().view).toBe('3d');
        expect(fresh.getState().twinFault).toBeNull();
      });

      it('goes to 3D when asked, and remembers it', () => {
        state().setView('3d');

        expect(state().view).toBe('3d');
        expect(localStorage.getItem(KEY)).toBe('3d');
      });

      it('puts the stage on 2D when the context is lost, and leaves the stored choice', () => {
        state().setView('3d');

        state().markTwinLost();

        expect(state().twinFault).toBe('context-lost');
        expect(state().view).toBe('2d');
        expect(localStorage.getItem(KEY)).toBe('3d');
      });

      it('does not go to 3D while the fault stands, and remembers nothing', () => {
        state().markTwinLost();

        state().setView('3d');

        expect(state().view).toBe('2d');
        expect(localStorage.getItem(KEY)).toBeNull();
      });

      it('returns to the stored choice when the fault is cleared', () => {
        state().setView('3d');
        state().markTwinLost();

        state().clearTwinLost();

        expect(state().twinFault).toBeNull();
        expect(state().view).toBe('3d');
      });

      it('stays on 2D after the fault is cleared when 2D was chosen', () => {
        state().setView('2d');
        state().markTwinLost();

        state().clearTwinLost();

        expect(state().view).toBe('2d');
      });
    });
  });

  describe('layers', () => {
    it('opens with incidents, cameras, assets and inside shown, and heat off', () => {
      expect(useConsole.getInitialState().layers).toEqual({
        incidents: true,
        cameras: true,
        assets: true,
        inside: true,
        heat: false,
      });
    });

    it('turns heat on and off like any other layer, and leaves the others as they were', () => {
      state().toggleLayer('heat');
      expect(state().layers.heat).toBe(true);
      expect(state().layers.incidents).toBe(true);

      state().toggleLayer('heat');
      expect(state().layers.heat).toBe(false);

      state().showLayer('heat');
      expect(state().layers.heat).toBe(true);
    });

    it('hides and shows one layer and leaves the others', () => {
      state().toggleLayer('cameras');
      expect(state().layers).toEqual({
        incidents: true,
        cameras: false,
        assets: true,
        inside: true,
        heat: false,
      });

      state().toggleLayer('cameras');
      expect(state().layers).toEqual({
        incidents: true,
        cameras: true,
        assets: true,
        inside: true,
        heat: false,
      });
    });

    it('is not remembered in this browser', () => {
      localStorage.clear();

      state().toggleLayer('assets');

      expect(localStorage.length).toBe(0);
    });

    it('shows a hidden layer, and keeps the same object when it is already shown', () => {
      state().toggleLayer('incidents');

      state().showLayer('incidents');
      expect(state().layers.incidents).toBe(true);

      const before = state().layers;
      state().showLayer('incidents');
      expect(state().layers).toBe(before);
    });

    it('shows the incidents again when one is selected', () => {
      state().toggleLayer('incidents');

      state().select('a');

      expect(state().layers.incidents).toBe(true);
    });

    it('leaves the other layers as they were when an incident is selected', () => {
      state().toggleLayer('incidents');
      state().toggleLayer('cameras');

      state().select('a');

      expect(state().layers).toEqual({
        incidents: true,
        cameras: false,
        assets: true,
        inside: true,
        heat: false,
      });
    });

    it('shows the assets again when an asset is selected', () => {
      state().toggleLayer('assets');

      state().selectAsset('CT-01', null);

      expect(state().layers.assets).toBe(true);
    });

    it('leaves the other layers as they were when an asset is selected', () => {
      state().toggleLayer('assets');
      state().toggleLayer('incidents');

      state().selectAsset('CT-01', null);

      expect(state().layers).toEqual({
        incidents: false,
        cameras: true,
        assets: true,
        inside: true,
        heat: false,
      });
    });

    it('does not show the assets again when the asset is deselected', () => {
      state().toggleLayer('assets');

      state().selectAsset(null);

      expect(state().layers.assets).toBe(false);
    });

    it('does not show them again when the incident is closed', () => {
      state().toggleLayer('incidents');

      state().select(null);

      expect(state().layers.incidents).toBe(false);
    });

    describe('inside (V2-15.9)', () => {
      it('hides and shows Inside and leaves the others', () => {
        state().toggleLayer('inside');
        expect(state().layers).toEqual({
          incidents: true,
          cameras: true,
          assets: true,
          inside: false,
          heat: false,
        });

        state().toggleLayer('inside');
        expect(state().layers.inside).toBe(true);
      });

      it('shows it again, and keeps the same object when it already is shown', () => {
        state().toggleLayer('inside');

        state().showLayer('inside');
        expect(state().layers.inside).toBe(true);

        const before = state().layers;
        state().showLayer('inside');
        expect(state().layers).toBe(before);
      });

      it('is not remembered in this browser', () => {
        localStorage.clear();

        state().toggleLayer('inside');

        expect(localStorage.length).toBe(0);
      });

      it('stays as the operator left it when an incident or an asset is selected', () => {
        state().toggleLayer('inside');

        state().select('a');
        expect(state().layers.inside).toBe(false);

        state().selectAsset('UPS-01', 'BLD-DC');
        expect(state().layers.inside).toBe(false);
      });

      it('stays as it was through focusing a building, leaving it and going to the campus', () => {
        state().toggleLayer('inside');

        state().focusBuilding('BLD-DC');
        state().goUp();
        state().focusBuilding('BLD-DC');
        state().goCampus();

        expect(state().layers.inside).toBe(false);
      });

      it('is shown again after a reset of the store', () => {
        state().toggleLayer('inside');

        resetStore(useConsole);

        expect(state().layers.inside).toBe(true);
      });
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

  // The store reads the window once, when its module is created, so these load it afresh (V2-21.2).
  describe('wall mode', () => {
    afterEach(() => {
      vi.resetModules();
      history.replaceState(null, '', '/');
      sessionStorage.clear();
      localStorage.clear();
    });

    const freshStore = async () => (await import('./store')).useConsole;

    it('is off in the console people operate', () => {
      expect(state().wall).toBeNull();
    });

    it('is on, with its number, for a window opened with ?wall=N', async () => {
      history.replaceState(null, '', '/?wall=2');
      vi.resetModules();

      expect((await freshStore()).getState().wall).toBe(2);
    });

    it('is still on after the sign-in redirect, from what the tab remembered', async () => {
      sessionStorage.setItem('occ.console.wall', '3');
      history.replaceState(null, '', '/?code=abc&state=xyz');
      vi.resetModules();

      expect((await freshStore()).getState().wall).toBe(3);
    });

    it('makes no sound, whatever was stored for the console', async () => {
      localStorage.setItem('occ.console.criticalSound', 'true');
      history.replaceState(null, '', '/?wall=1');
      vi.resetModules();

      const wall = await freshStore();

      expect(wall.getState().criticalSound).toBe(false);
      // The stored choice is left as it was: it is the operators' consoles', not the wall's.
      expect(localStorage.getItem('occ.console.criticalSound')).toBe('true');
    });
  });
  // The 3D view's drag tool (V3-29): a session choice, Orbit by default, left alone by the level ladder.
  describe('drag tool', () => {
    it('starts as Orbit', () => {
      expect(useConsole.getState().panTool).toBe(false);
    });

    it('is set and toggled', () => {
      useConsole.getState().setPanTool(true);
      expect(useConsole.getState().panTool).toBe(true);

      useConsole.getState().togglePanTool();
      expect(useConsole.getState().panTool).toBe(false);

      useConsole.getState().togglePanTool();
      expect(useConsole.getState().panTool).toBe(true);
    });

    it('is not cleared by going up a level or back to the campus', () => {
      useConsole.getState().selectAsset('CT-01', 'dc');
      useConsole.getState().setPanTool(true);

      useConsole.getState().goUp();
      useConsole.getState().goCampus();

      expect(useConsole.getState().panTool).toBe(true);
    });

    it('is not remembered: nothing is written to storage', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      useConsole.getState().setPanTool(true);

      expect(setItem).not.toHaveBeenCalled();
      setItem.mockRestore();
    });
  });
});

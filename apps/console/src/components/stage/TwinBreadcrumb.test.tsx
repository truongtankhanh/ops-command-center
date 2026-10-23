import type { Asset, Zone } from '@occ/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../../api/queries';
import { TWIN_VIEW_ID } from '../../lib/twin-core/twinSummary';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { TwinBreadcrumb } from './TwinBreadcrumb';

const POSITION: [number, number] = [108.44, 11.95];

const zone = (id: string, name: string, kind: Zone['kind']): Zone => ({
  id,
  code: id.toUpperCase(),
  name,
  kind,
  polygon: [],
  center: POSITION,
});

const DATA_CENTER = zone('z-dc', 'Data Center', 'building');
const UTILITY = zone('z-util', 'Utility Plant', 'utility');

const asset = (code: string, name: string, zoneId: string): Asset => ({
  id: `asset-${code}`,
  code,
  name,
  class: {
    id: 'class-x',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId,
  position: POSITION,
  elevationM: 0,
  headingDeg: 0,
  headline: [],
});

const CT_01 = asset('CT-01', 'Cooling tower 1', 'z-dc');
const TR_01 = asset('TR-01', 'Main transformer', 'z-util');

interface Data {
  zones?: Zone[];
  assets?: Asset[];
}

/** The breadcrumb with the reference data the console holds, and the 3D view's tab stop it hands focus to. */
function renderCrumbs({ zones = [DATA_CENTER, UTILITY], assets = [CT_01, TR_01] }: Data = {}) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.assets, assets);
  return renderWithQueryClient(
    <>
      <TwinBreadcrumb />
      <div id={TWIN_VIEW_ID} tabIndex={0} />
    </>,
    client,
  );
}

const store = () => useConsole.getState();
const crumbs = () =>
  within(screen.getByRole('navigation', { name: 'Scene level' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
const level = () => ({
  focusZoneId: store().focusZoneId,
  selectedAssetCode: store().selectedAssetCode,
  selectedPart: store().selectedPart,
});

describe('TwinBreadcrumb', () => {
  beforeEach(() => resetStore(useConsole));

  it('is absent at the campus level', () => {
    renderCrumbs();

    expect(screen.queryByRole('navigation', { name: 'Scene level' })).toBeNull();
  });

  describe('what it reads (AC1)', () => {
    it('reads Campus › Data Center › CT-01 for an asset in a building', () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs();

      expect(crumbs()).toEqual(['Campus', 'Data Center', 'CT-01']);
    });

    it('reads Campus › Data Center at building level', () => {
      store().focusBuilding('z-dc');
      renderCrumbs();

      expect(crumbs()).toEqual(['Campus', 'Data Center']);
    });

    it('has no middle crumb for an asset outside every building', () => {
      store().selectAsset('TR-01', null);
      renderCrumbs();

      expect(crumbs()).toEqual(['Campus', 'TR-01']);
    });

    it('does not turn a part into a crumb: it is the callout', () => {
      store().selectAsset('CT-01', 'z-dc');
      store().selectPart('FanBlade');
      renderCrumbs();

      expect(crumbs()).toEqual(['Campus', 'Data Center', 'CT-01']);
    });

    it('leaves out a building or an asset the console does not hold yet, and never shows an id', () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs({ zones: [], assets: [] });

      expect(crumbs()).toEqual(['Campus']);
      expect(screen.queryByText('z-dc')).toBeNull();
      expect(screen.queryByText('CT-01')).toBeNull();
    });

    it('marks the current item as the place and makes the others buttons', () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs();

      const current = screen.getByText('CT-01');
      expect(current.tagName).toBe('STRONG');
      expect(current).toHaveAttribute('aria-current', 'location');
      expect(screen.queryByRole('button', { name: 'CT-01' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Campus' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Data Center' })).toBeInTheDocument();
    });
  });

  describe('the back button', () => {
    it.each([
      ['an asset in a building', () => store().selectAsset('CT-01', 'z-dc'), 'Data Center'],
      ['an asset outside every building', () => store().selectAsset('TR-01', null), 'Campus'],
      ['a building', () => store().focusBuilding('z-dc'), 'Campus'],
    ])('names the level it goes up to, for %s', (_name, select, parent) => {
      select();
      renderCrumbs();

      expect(screen.getByRole('button', { name: `Up one level — ${parent}` })).toBeInTheDocument();
    });

    it('names the asset at the level of a part, where going up closes the callout', () => {
      store().selectAsset('CT-01', 'z-dc');
      store().selectPart('FanBlade');
      renderCrumbs();

      expect(screen.getByRole('button', { name: 'Up one level — CT-01' })).toBeInTheDocument();
    });

    it('goes up one level from an asset: the building stays in focus', async () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: /Up one level/ }));

      expect(level()).toEqual({ focusZoneId: 'z-dc', selectedAssetCode: null, selectedPart: null });
      expect(crumbs()).toEqual(['Campus', 'Data Center']);
    });

    it('goes up from a building to the campus, and the breadcrumb goes', async () => {
      store().focusBuilding('z-dc');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: 'Up one level — Campus' }));

      expect(level()).toEqual({ focusZoneId: null, selectedAssetCode: null, selectedPart: null });
      expect(screen.queryByRole('navigation', { name: 'Scene level' })).toBeNull();
    });

    it('goes from an asset outside every building straight to the campus', async () => {
      store().selectAsset('TR-01', null);
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: 'Up one level — Campus' }));

      expect(level()).toEqual({ focusZoneId: null, selectedAssetCode: null, selectedPart: null });
    });

    it('closes the part first and keeps the asset', async () => {
      store().selectAsset('CT-01', 'z-dc');
      store().selectPart('FanBlade');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: /Up one level/ }));

      expect(level()).toEqual({
        focusZoneId: 'z-dc',
        selectedAssetCode: 'CT-01',
        selectedPart: null,
      });
    });
  });

  describe('the crumbs that lead up', () => {
    it('go to the campus from the Campus crumb: the asset is deselected and the building left', async () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: 'Campus' }));

      expect(level()).toEqual({ focusZoneId: null, selectedAssetCode: null, selectedPart: null });
    });

    it('go to the building from its crumb at asset level', async () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: 'Data Center' }));

      expect(level()).toEqual({ focusZoneId: 'z-dc', selectedAssetCode: null, selectedPart: null });
    });

    it('keep an open incident', async () => {
      store().select('a');
      store().focusBuilding('z-dc');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: 'Campus' }));

      expect(store().selectedIncidentId).toBe('a');
    });
  });

  describe('focus', () => {
    it('goes to the 3D view after the back button, which may have removed the control that had it', async () => {
      store().focusBuilding('z-dc');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: /Up one level/ }));

      expect(document.activeElement).toBe(document.getElementById(TWIN_VIEW_ID));
    });

    it('goes to the 3D view after a crumb', async () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs();

      await userEvent.click(screen.getByRole('button', { name: 'Data Center' }));

      expect(document.activeElement).toBe(document.getElementById(TWIN_VIEW_ID));
    });

    it('can be reached with the keyboard in reading order: back, then each crumb that leads up', async () => {
      store().selectAsset('CT-01', 'z-dc');
      renderCrumbs();

      await userEvent.tab();
      expect(screen.getByRole('button', { name: /Up one level/ })).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Campus' })).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Data Center' })).toHaveFocus();
    });
  });

  it('has no accessibility violation', async () => {
    store().selectAsset('CT-01', 'z-dc');
    const { container } = renderCrumbs();

    await expectNoAxeViolations(container);
  });
});
